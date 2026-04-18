/**
 * Primitive schemas — shared enums and small value types.
 *
 * These are the leaf-level schemas everything else composes from. Keeping
 * them in one file means a new profile type / difficulty level / action type
 * is a single-file edit.
 *
 * Design rationale:
 *   Using z.enum() instead of z.literal union because enum() gives a runtime
 *   `.options` array we can use to drive UI (dropdowns) and to keep the
 *   registerAllowedProfile() dynamic-extension mechanism working.
 */
import { z } from "zod";

// ─── Neurodiversity ──────────────────────────────────────────────────────────

/**
 * Built-in profiles. Additional profiles registered at runtime via
 * ProfileRegistry are handled with a permissive refinement, not by mutating
 * this schema — see NeurodiversityTypeSchema below.
 */
export const BuiltInNeurodiversityTypes = [
  "neurotypical",
  "dyslexia",
  "autism",
  "adhd",
] as const;

/** Mutable registry for dynamically-added profile types. */
const dynamicProfiles = new Set<string>();

/** Register an additional allowed profile type (from ProfileRegistry). */
export function registerProfileType(type: string): void {
  dynamicProfiles.add(type);
}

/** Read-only view of the current allowed profile types (for diagnostics/UI). */
export function getAllowedProfileTypes(): string[] {
  return [...BuiltInNeurodiversityTypes, ...dynamicProfiles];
}

/**
 * NeurodiversityTypeSchema accepts built-in values OR anything registered
 * at runtime. We can't use z.enum() directly because the set is extensible.
 */
export const NeurodiversityTypeSchema = z
  .string()
  .refine(
    (v): v is string => (BuiltInNeurodiversityTypes as readonly string[]).includes(v) || dynamicProfiles.has(v),
    {
      error: (iss) =>
        `Unknown neurodiversity type "${String(iss.input)}". Allowed: ${getAllowedProfileTypes().join(", ")}`,
    },
  );

export type NeurodiversityType = z.infer<typeof NeurodiversityTypeSchema>;

// ─── Difficulty ──────────────────────────────────────────────────────────────

export const DifficultySchema = z.enum(["beginner", "intermediate", "advanced"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

// ─── Color schemes / font families ───────────────────────────────────────────

export const ColorSchemeSchema = z.enum([
  "default", "high-contrast", "warm", "cool", "pastel",
]);
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;

// ─── Task granularity ────────────────────────────────────────────────────────

export const TaskGranularitySchema = z.enum(["combined", "standard", "detailed"]);
export type TaskGranularity = z.infer<typeof TaskGranularitySchema>;

// ─── Assignment section types ────────────────────────────────────────────────

export const SectionTypeSchema = z.enum([
  "instruction", "task", "hint", "example", "reference",
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

// ─── Adaptation primitives ───────────────────────────────────────────────────

export const VisualModificationTypeSchema = z.enum([
  "color", "font", "spacing", "highlight", "icon", "border",
]);

export const SuggestedActionTypeSchema = z.enum([
  "break", "simplify", "example", "hint", "encouragement", "restructure",
]);

export const PrioritySchema = z.enum(["low", "medium", "high"]);

// ─── Structural / cognitive preference enums ─────────────────────────────────

export const ChunkSizeSchema = z.enum(["small", "medium", "large"]);
export const BulletStyleSchema = z.enum(["bullets", "numbers", "icons"]);

// ─── MCP ─────────────────────────────────────────────────────────────────────

export const McpTransportSchema = z.enum(["stdio", "streamableHttp"]);
export type McpTransport = z.infer<typeof McpTransportSchema>;
