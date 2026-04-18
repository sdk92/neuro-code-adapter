/**
 * User preferences schemas.
 *
 * Mirrors the existing UserPreferences shape from types.ts, but now with
 * runtime validation and inferred types. Any caller that constructs
 * preferences from external input (VS Code settings, saved state, webview
 * apply_preferences message) can call .parse() / .safeParse() to catch
 * malformed data instead of letting it poison the rest of the pipeline.
 *
 * Defaults match the previous hand-written defaults in profiles.ts and
 * builtinProfiles.ts — the Zod .default() calls are harmless when the
 * caller supplies complete preferences, but save a lot of error-prone
 * null coalescing in consumers.
 */
import { z } from "zod";
import {
  BulletStyleSchema,
  ChunkSizeSchema,
  ColorSchemeSchema,
  NeurodiversityTypeSchema,
  TaskGranularitySchema,
} from "./primitives";

// ─── Visual ──────────────────────────────────────────────────────────────────

export const VisualPreferencesSchema = z.object({
  colorScheme: ColorSchemeSchema.default("default"),
  fontSize: z.number().int().min(10).max(28).default(14),
  fontFamily: z.string().default("default"),
  lineSpacing: z.number().min(1.0).max(3.0).default(1.5),
  letterSpacing: z.number().min(0).max(0.2).default(0),
  paragraphSpacing: z.number().min(0).max(3.0).default(1.0),
  maxLineWidth: z.number().int().min(40).max(200).default(80),
});
export type VisualPreferences = z.infer<typeof VisualPreferencesSchema>;

// ─── Structural ──────────────────────────────────────────────────────────────

export const StructuralPreferencesSchema = z.object({
  chunkSize: ChunkSizeSchema.default("medium"),
  progressiveDisclosure: z.boolean().default(false),
  showStepNumbers: z.boolean().default(true),
  showCheckboxes: z.boolean().default(true),
  bulletStyle: BulletStyleSchema.default("bullets"),
  sectionCollapsible: z.boolean().default(false),
  taskGranularity: TaskGranularitySchema.default("standard"),
});
export type StructuralPreferences = z.infer<typeof StructuralPreferencesSchema>;

// ─── Cognitive ───────────────────────────────────────────────────────────────

export const CognitivePreferencesSchema = z.object({
  focusMode: z.boolean().default(false),
  textToSpeech: z.boolean().default(false),
  highlightCurrentStep: z.boolean().default(false),
  showTimers: z.boolean().default(false),
  breakReminders: z.boolean().default(false),
  breakIntervalMinutes: z.number().int().min(5).max(120).default(25),
  simplifiedLanguage: z.boolean().default(false),
  showExamples: z.boolean().default(true),
});
export type CognitivePreferences = z.infer<typeof CognitivePreferencesSchema>;

// ─── Composite ───────────────────────────────────────────────────────────────

export const UserPreferencesSchema = z.object({
  neurodiversityType: NeurodiversityTypeSchema,
  visual: VisualPreferencesSchema,
  structural: StructuralPreferencesSchema,
  cognitive: CognitivePreferencesSchema,
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * Partial version — used on the webview → extension wire protocol for
 * apply_preferences messages where the webview only sends what the user touched.
 *
 * deepPartial makes nested fields optional too, which matches how the
 * frontend collects values ("visual: { fontSize: 16 }" without the rest).
 */
export const PartialUserPreferencesSchema = z.object({
  neurodiversityType: NeurodiversityTypeSchema.optional(),
  visual: VisualPreferencesSchema.partial().optional(),
  structural: StructuralPreferencesSchema.partial().optional(),
  cognitive: CognitivePreferencesSchema.partial().optional(),
});
export type PartialUserPreferences = z.infer<typeof PartialUserPreferencesSchema>;

// ─── Neurodiversity profile (metadata wrapper) ───────────────────────────────

/**
 * Matches the NeurodiversityProfile interface from types.ts.
 * defaultPreferences is a Partial because each profile only overrides
 * the preferences that differ from the neurotypical baseline.
 */
export const NeurodiversityProfileSchema = z.object({
  type: NeurodiversityTypeSchema,
  label: z.string(),
  description: z.string(),
  defaultPreferences: PartialUserPreferencesSchema,
});
export type NeurodiversityProfile = z.infer<typeof NeurodiversityProfileSchema>;
