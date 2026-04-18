/**
 * MessageValidator — Runtime validation for webview messages.
 *
 * REFACTORED (M2): Hand-rolled FieldSpec table and typeof loop replaced
 * with Zod's discriminated union in @shared/schemas/webview-messages.
 *
 * Contract preserved:
 *   - Same ValidationResult return shape (valid / errors / message)
 *   - Same Logger.warn side effect on failure
 *   - Same public export: validateWebviewMessage, registerAllowedProfile
 *
 * What improved:
 *   - The `message as unknown as WebviewMessage` double-cast is gone —
 *     Zod's z.infer gives a genuinely validated type.
 *   - Deep validation: apply_preferences.preferences.visual.fontSize is
 *     now checked against its actual range [10, 28] instead of just
 *     "is this an object".
 *   - Error messages include path context ("preferences.visual.fontSize:
 *     expected number ≥ 10, got 5") instead of just "expected object".
 *   - One source of truth: WebviewMessage type and validator are literally
 *     the same object. Adding a new message type is one edit in
 *     webview-messages.ts, not two edits here + in messages.ts.
 */
import type { WebviewMessage } from "./schemas";
import { WebviewMessageSchema, registerProfileType } from "./schemas";
import { Logger } from "./logger";
import type { ZodIssue } from "zod";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  message: WebviewMessage | null;
}

/**
 * Validate and sanitise an incoming webview message.
 *
 * Returns a result object — never throws. Callers decide how to handle
 * invalid messages (the controller logs and drops them).
 */
export function validateWebviewMessage(raw: unknown): ValidationResult {
  const result = WebviewMessageSchema.safeParse(raw);

  if (result.success) {
    return { valid: true, errors: [], message: result.data };
  }

  const errors = result.error.issues.map(formatIssue);
  const type = typeof raw === "object" && raw && "type" in raw ? String((raw as { type: unknown }).type) : "<unknown>";
  Logger.warn(`Webview message validation failed for "${type}": ${errors.join("; ")}`);
  return { valid: false, errors, message: null };
}

/**
 * Format a Zod issue into the terse single-line messages the old validator produced.
 * Zod's built-in messages already say things like "Expected string, received number"
 * and "Required" — we just prefix them with the field path.
 */
function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
  // "Required" → "Missing required field <path>" to match the old validator's phrasing
  // that existing callers may grep for.
  if (issue.code === "invalid_type" && issue.message === "Required") {
    return `Missing required field "${path}"`;
  }
  return `${path}: ${issue.message}`;
}

/**
 * Extend allowed profiles at runtime (for dynamically registered profiles).
 * Backward-compatible: same signature as the old MessageValidator export.
 */
export function registerAllowedProfile(profile: string): void {
  registerProfileType(profile);
}
