/**
 * Assignment schemas.
 *
 * Replaces the hand-written validateAndNormalise() in parser.ts.
 *
 * Key improvements over the old validator:
 *   - `z.coerce.string()` where legacy behavior was `String(x ?? fallback)` —
 *     same coercion, but the schema is declarative and tested
 *   - Defaults applied via `.default(...)` instead of `??` ternaries in 20 places
 *   - Strict enum membership instead of `["...", "..."].includes(x)` checks
 *   - One source of truth for types + validation (infer via z.infer)
 *
 * The "coerce" variant on metadata fields preserves backward-compat with
 * LLM outputs that may emit numeric difficulty strings, boolean-like strings,
 * etc. For webview-origin data (apply_preferences), use the strict schemas
 * in preferences.ts — we trust the webview less than we trust our own parser.
 */
import { z } from "zod";
import {
  DifficultySchema,
  NeurodiversityTypeSchema,
  SectionTypeSchema,
} from "./primitives";

// ─── Metadata ────────────────────────────────────────────────────────────────

export const AssignmentMetadataSchema = z.object({
  id: z.coerce.string().default(() => `assignment_${Date.now()}`),
  title: z.coerce.string().default("Untitled Assignment"),
  description: z.coerce.string().default(""),
  author: z.coerce.string().default("Unknown"),
  createdAt: z.coerce.string().default(() => new Date().toISOString()),
  updatedAt: z.coerce.string().default(() => new Date().toISOString()),
  difficulty: DifficultySchema.default("intermediate"),
  estimatedMinutes: z.coerce.number().int().nonnegative().default(60),
  language: z.coerce.string().default("Unknown"),
  tags: z.array(z.coerce.string()).default([]),
});
export type AssignmentMetadata = z.infer<typeof AssignmentMetadataSchema>;

// ─── Section ─────────────────────────────────────────────────────────────────

// Recursive type for AssignmentSection (it has optional children: AssignmentSection[])
// Requires the z.ZodType annotation trick.
export type AssignmentSection = {
  id: string;
  title: string;
  content: string;
  type: z.infer<typeof SectionTypeSchema>;
  order: number;
  children?: AssignmentSection[];
};

export const AssignmentSectionSchema: z.ZodType<AssignmentSection> = z.lazy(() =>
  z.object({
    id: z.coerce.string(),
    title: z.coerce.string().default("Untitled Section"),
    content: z.coerce.string().default(""),
    type: SectionTypeSchema.default("instruction"),
    order: z.coerce.number().int().default(0),
    children: z.array(AssignmentSectionSchema).optional(),
  }),
);

// ─── Test cases ──────────────────────────────────────────────────────────────

export const AssignmentTestCaseSchema = z.object({
  id: z.coerce.string(),
  description: z.coerce.string().default(""),
  input: z.coerce.string().default(""),
  expectedOutput: z.coerce.string().default(""),
  isHidden: z.coerce.boolean().default(false),
});
export type AssignmentTestCase = z.infer<typeof AssignmentTestCaseSchema>;

// ─── Assignment (root) ───────────────────────────────────────────────────────

export const AssignmentSchema = z.object({
  metadata: AssignmentMetadataSchema,
  sections: z.array(AssignmentSectionSchema).min(1, "Assignment must contain at least one section"),
  starterCode: z.string().optional(),
  testCases: z.array(AssignmentTestCaseSchema).optional(),
  adaptationHints: z.record(NeurodiversityTypeSchema, z.string()).optional(),
});
export type Assignment = z.infer<typeof AssignmentSchema>;
