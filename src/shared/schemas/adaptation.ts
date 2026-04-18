/**
 * Adaptation schemas — LLM response contract.
 *
 * Replaces the hand-written validateAdaptationResponse() in AdaptationEngine.
 *
 * Why this matters:
 *   The AdaptationResponse schema is our *contract* with the LLM. The system
 *   prompt tells the model to emit JSON matching this shape. If the model
 *   drifts (wrong enum value, extra fields, missing priority, etc.), we
 *   need to catch that deterministically — not silently coerce to an
 *   empty string, which is what the old String(x ?? "") pattern did.
 *
 *   Zod's .safeParse() gives us a proper Result<T, E> and the error path
 *   feeds into the fallback-to-rule-based strategy in AdaptationEngine.
 *
 * The schema uses .default() for optional-with-fallback semantics and
 * .catch() for fields where we'd rather swallow a malformed value than
 * fail the whole response. Rules:
 *   - Structural fields (arrays, required objects) → fail hard (no .catch)
 *   - Cosmetic fields (confidenceScore, priority) → .catch(default)
 *
 * Matches the existing TypeScript AdaptationResponse interface in types.ts.
 */
import { z } from "zod";
import {
  PrioritySchema,
  SuggestedActionTypeSchema,
  VisualModificationTypeSchema,
} from "./primitives";
import { AssignmentSchema } from "./assignment";
import { UserPreferencesSchema } from "./preferences";

// ─── Visual modification ─────────────────────────────────────────────────────

export const VisualModificationSchema = z.object({
  type: VisualModificationTypeSchema,
  target: z.coerce.string(),
  value: z.coerce.string(),
});
export type VisualModification = z.infer<typeof VisualModificationSchema>;

// ─── Suggested action ────────────────────────────────────────────────────────

export const SuggestedActionSchema = z.object({
  type: SuggestedActionTypeSchema.catch("hint"),
  message: z.coerce.string(),
  // Cosmetic — a bad value just defaults, doesn't fail the whole response.
  priority: PrioritySchema.catch("low"),
});
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;

// ─── Adapted section ─────────────────────────────────────────────────────────

export const AdaptedSectionSchema = z.object({
  originalSectionId: z.coerce.string(),
  adaptedTitle: z.coerce.string().default(""),
  adaptedContent: z.coerce.string().default(""),
  visualModifications: z.array(VisualModificationSchema).default([]),
  structuralChanges: z.array(z.coerce.string()).default([]),
});
export type AdaptedSection = z.infer<typeof AdaptedSectionSchema>;

// ─── Full adaptation response ────────────────────────────────────────────────

export const AdaptationResponseSchema = z.object({
  adaptedSections: z.array(AdaptedSectionSchema),
  supportMessage: z.string().optional(),
  suggestedActions: z.array(SuggestedActionSchema).default([]),
  reasoning: z.coerce.string().default("No reasoning provided"),
  // Clamp to [0, 1]; invalid types fall back to 0.5.
  confidenceScore: z
    .number()
    .transform((v) => Math.max(0, Math.min(1, v)))
    .catch(0.5)
    .default(0.5),
});
export type AdaptationResponse = z.infer<typeof AdaptationResponseSchema>;

// ─── Adaptation request (extension → engine) ─────────────────────────────────

export const AdaptationRequestTypeSchema = z.enum([
  "full_adaptation",
  "help_request",
]);

export const AdaptationRequestSchema = z.object({
  assignment: AssignmentSchema,
  userPreferences: UserPreferencesSchema,
  requestType: AdaptationRequestTypeSchema,
  targetSectionId: z.string().optional(),
});
export type AdaptationRequest = z.infer<typeof AdaptationRequestSchema>;
