/**
 * Neurodiversity profile definitions.
 *
 * REFACTORED: This file is now a thin backward-compatibility layer.
 * Actual profile data lives in ProfileRegistry (registered via builtinProfiles.ts).
 *
 * Existing consumers that import NEURODIVERSITY_PROFILES or getDefaultPreferences
 * continue to work without changes.
 */
import type { NeurodiversityProfile, NeurodiversityType, UserPreferences } from "@shared/types";
import { ProfileRegistry } from "@shared/ProfileRegistry";

/**
 * NEURODIVERSITY_PROFILES — backward-compatible record accessor.
 *
 * Returns a snapshot of all registered profiles. Note: if profiles are
 * registered after this import, the reference won't update. For dynamic
 * access, use ProfileRegistry.getAllProfiles() directly.
 */
export function getNeurodiversityProfiles(): Record<string, NeurodiversityProfile> {
  return ProfileRegistry.getAllProfiles();
}

// For backward compatibility with static imports like:
//   import { NEURODIVERSITY_PROFILES } from "./profiles"
// We use a lazy getter so it always reflects the current registry state.
export const NEURODIVERSITY_PROFILES = new Proxy(
  {} as Record<NeurodiversityType, NeurodiversityProfile>,
  {
    get(_target, prop: string) {
      const mod = ProfileRegistry.get(prop);
      return mod?.profile;
    },
    ownKeys() {
      return ProfileRegistry.getTypes();
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      const mod = ProfileRegistry.get(prop as string);
      if (!mod) { return undefined; }
      return { configurable: true, enumerable: true, value: mod.profile };
    },
    has(_target, prop: string) {
      return ProfileRegistry.get(prop) !== undefined;
    },
  }
);

/**
 * Get full default preferences for a neurodiversity type.
 */
export function getDefaultPreferences(type: NeurodiversityType): UserPreferences {
  return ProfileRegistry.getDefaultPreferences(type);
}
