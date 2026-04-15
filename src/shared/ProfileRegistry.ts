/**
 * ProfileRegistry — Single source of truth for neurodiversity profiles.
 *
 * Problem solved: Adding a new profile (e.g. dyscalculia) previously required
 * editing 5+ files with scattered switch/if chains. Now you register a module
 * once and every subsystem picks it up automatically.
 *
 * Each NeurodiversityModule bundles:
 *   - Profile metadata (label, description, defaults)
 *   - Visual strategy (CSS vars, container classes, structural flags)
 *   - Rule-based adapter (offline fallback when LLM is unavailable)
 *   - Prompt fragment (injected into the LLM system prompt)
 */
import type {
  AdaptedSection,
  AssignmentSection,
  NeurodiversityProfile,
  NeurodiversityType,
  UserPreferences,
} from "./types";
import type { AdaptationStrategy } from "@features/adaptive/strategies";

// ─── Module Interface ────────────────────────────────────────────────────────

export interface NeurodiversityModule {
  /** Unique type key — must match NeurodiversityType union */
  type: string;

  /** Profile metadata (label, description, default preferences) */
  profile: NeurodiversityProfile;

  /** Visual/structural strategy used by AdaptiveRenderer */
  strategy: AdaptationStrategy;

  /** Rule-based section adapter (offline fallback, no LLM needed) */
  ruleBasedAdapter: (
    section: AssignmentSection,
    prefs: UserPreferences
  ) => AdaptedSection;

  /** Prompt fragment injected into AdaptationEngine's system prompt */
  promptFragment: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, NeurodiversityModule>();

export const ProfileRegistry = {
  /**
   * Register a neurodiversity module.
   * Overwrites any existing module with the same type key.
   */
  register(mod: NeurodiversityModule): void {
    registry.set(mod.type, mod);
  },

  /**
   * Get a module by type. Returns undefined if not registered.
   */
  get(type: string): NeurodiversityModule | undefined {
    return registry.get(type);
  },

  /**
   * Get a module by type, throwing if not found.
   */
  getOrThrow(type: string): NeurodiversityModule {
    const mod = registry.get(type);
    if (!mod) {
      throw new Error(
        `No neurodiversity module registered for type "${type}". ` +
        `Available: ${[...registry.keys()].join(", ")}`
      );
    }
    return mod;
  },

  /**
   * Get all registered modules.
   */
  getAll(): NeurodiversityModule[] {
    return [...registry.values()];
  },

  /**
   * Get all registered type keys.
   */
  getTypes(): string[] {
    return [...registry.keys()];
  },

  /**
   * Get all profiles as a record (backward-compatible with NEURODIVERSITY_PROFILES).
   */
  getAllProfiles(): Record<string, NeurodiversityProfile> {
    const result: Record<string, NeurodiversityProfile> = {};
    for (const [key, mod] of registry) {
      result[key] = mod.profile;
    }
    return result;
  },

  /**
   * Get all strategies as a record.
   */
  getAllStrategies(): Record<string, AdaptationStrategy> {
    const result: Record<string, AdaptationStrategy> = {};
    for (const [key, mod] of registry) {
      result[key] = mod.strategy;
    }
    return result;
  },

  /**
   * Build combined prompt fragments for all registered profiles.
   */
  buildCombinedPromptFragments(): string {
    return [...registry.values()]
      .map((mod) => mod.promptFragment)
      .join("\n\n");
  },

  /**
   * Get default preferences for a type.
   */
  getDefaultPreferences(type: string): UserPreferences {
    const mod = this.getOrThrow(type);
    const p = mod.profile.defaultPreferences;
    return {
      neurodiversityType: type as NeurodiversityType,
      visual: p.visual!,
      structural: p.structural!,
      cognitive: p.cognitive!,
    } as UserPreferences;
  },

  /**
   * Clear all registrations (useful for testing).
   */
  clear(): void {
    registry.clear();
  },
};
