/**
 * MessageValidator — Runtime validation for webview messages.
 *
 * Problem solved: handleWebviewMessage trusted all incoming message fields
 * without validation. Webview is an untrusted execution environment — malformed
 * messages could cause runtime errors or unexpected behavior.
 *
 * Uses a lightweight schema-based approach (no Zod dependency needed).
 * Each message type declares required fields and their expected types.
 */
import type { WebviewMessage } from "./messages";
import { Logger } from "./logger";

// ─── Validation schema per message type ──────────────────────────────────────

interface FieldSpec {
  type: "string" | "boolean" | "number" | "object";
  required: boolean;
}

type MessageSchema = Record<string, FieldSpec>;

const MESSAGE_SCHEMAS: Record<string, MessageSchema> = {
  ready: {},
  request_state: {},
  open_assignment: {},
  open_preferences: {},
  request_help: {
    question: { type: "string", required: false },
    sectionId: { type: "string", required: false },
  },
  set_profile: {
    profile: { type: "string", required: true },
  },
  section_viewed: {
    sectionId: { type: "string", required: true },
  },
  export_progress: {},
  connect_mcp: {
    url: { type: "string", required: true },
    transport: { type: "string", required: false },
  },
  disconnect_mcp: {},
  request_scaffold: {},
  apply_preferences: {
    preferences: { type: "object", required: true },
  },
  scaffold_approval_response: {
    toolUseId: { type: "string", required: true },
    approved: { type: "boolean", required: true },
  },
};

// ─── Allowed values for constrained fields ───────────────────────────────────

const ALLOWED_PROFILES = new Set([
  "neurotypical", "dyslexia", "autism", "adhd",
]);

const ALLOWED_TRANSPORTS = new Set(["stdio", "streamableHttp"]);

// ─── Validation result ───────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** The sanitised message (with defaults applied), or null if invalid */
  message: WebviewMessage | null;
}

// ─── Validator ───────────────────────────────────────────────────────────────

/**
 * Validate and sanitise an incoming webview message.
 *
 * Returns a ValidationResult with:
 *   - valid: whether the message passed all checks
 *   - errors: list of validation errors (empty if valid)
 *   - message: the sanitised message, or null if invalid
 */
export function validateWebviewMessage(raw: unknown): ValidationResult {
  const errors: string[] = [];

  // Basic shape check
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Message is not an object"], message: null };
  }

  const msg = raw as Record<string, unknown>;

  // Type field is mandatory
  if (typeof msg.type !== "string") {
    return { valid: false, errors: ["Missing or invalid 'type' field"], message: null };
  }

  const type = msg.type;

  // Check if the type is recognized
  const schema = MESSAGE_SCHEMAS[type];
  if (!schema) {
    return { valid: false, errors: [`Unknown message type: "${type}"`], message: null };
  }

  // Validate each field against the schema
  for (const [field, spec] of Object.entries(schema)) {
    const value = msg[field];

    if (spec.required && (value === undefined || value === null)) {
      errors.push(`Missing required field "${field}" for message type "${type}"`);
      continue;
    }

    if (value !== undefined && value !== null) {
      const actualType = typeof value;
      if (actualType !== spec.type) {
        errors.push(
          `Field "${field}" expected ${spec.type}, got ${actualType} for message type "${type}"`
        );
      }
    }
  }

  // Domain-specific constraints
  if (type === "set_profile" && typeof msg.profile === "string") {
    if (!ALLOWED_PROFILES.has(msg.profile)) {
      errors.push(`Invalid profile "${msg.profile}". Allowed: ${[...ALLOWED_PROFILES].join(", ")}`);
    }
  }

  if (type === "connect_mcp" && typeof msg.transport === "string") {
    if (!ALLOWED_TRANSPORTS.has(msg.transport)) {
      errors.push(`Invalid transport "${msg.transport}". Allowed: ${[...ALLOWED_TRANSPORTS].join(", ")}`);
    }
  }

  if (errors.length > 0) {
    Logger.warn(`Webview message validation failed for "${type}": ${errors.join("; ")}`);
    return { valid: false, errors, message: null };
  }

  return { valid: true, errors: [], message: msg as unknown as WebviewMessage };
}

/**
 * Extend allowed profiles at runtime (for dynamically registered profiles).
 */
export function registerAllowedProfile(profile: string): void {
  ALLOWED_PROFILES.add(profile);
}
