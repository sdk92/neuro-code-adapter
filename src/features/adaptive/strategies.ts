/**
 * Adaptation strategies per neurodiversity profile.
 *
 * Each strategy defines CSS variables, structural transforms,
 * and content processing rules specific to a profile.
 * Used by AdaptiveRenderer to apply deterministic visual adaptations.
 *
 * REFACTORED: Base strategies now come from ProfileRegistry instead of
 * a hardcoded switch chain. Adding a new profile no longer requires
 * editing this file.
 */
import type { UserPreferences } from "@shared/types";
import { ProfileRegistry } from "@shared/ProfileRegistry";

export interface AdaptationStrategy {
  /** CSS custom properties applied to the adaptive view */
  cssVariables: Record<string, string>;
  /** CSS class names added to the root container */
  containerClasses: string[];
  /** Whether to wrap code blocks in expandable details */
  collapseCodeBlocks: boolean;
  /** Whether to add checkboxes to task items */
  addCheckboxes: boolean;
  /** Whether to insert section dividers */
  insertDividers: boolean;
  /** Whether to prepend quick-summary boxes */
  addSummaryBoxes: boolean;
  /** Maximum characters per paragraph before auto-splitting */
  maxParagraphLength: number;
  /** Whether to add time estimate badges */
  showTimeEstimates: boolean;
}

/**
 * Build an adaptation strategy from user preferences.
 *
 * Looks up the base strategy from ProfileRegistry, then applies
 * user-specific overrides (font size, spacing, focus mode, etc.).
 */
export function buildStrategy(preferences: UserPreferences): AdaptationStrategy {
  const base = getBaseStrategy(preferences.neurodiversityType);

  // Override with user-specific preferences
  base.cssVariables["--nc-font-size"] = `${preferences.visual.fontSize}px`;
  base.cssVariables["--nc-line-height"] = `${preferences.visual.lineSpacing}`;
  base.cssVariables["--nc-letter-spacing"] = `${preferences.visual.letterSpacing}em`;
  base.cssVariables["--nc-paragraph-spacing"] = `${preferences.visual.paragraphSpacing}em`;
  base.cssVariables["--nc-max-width"] = `${preferences.visual.maxLineWidth}ch`;

  if (preferences.visual.fontFamily !== "default") {
    base.cssVariables["--nc-font-family"] = `'${preferences.visual.fontFamily}', sans-serif`;
  }

  base.addCheckboxes = preferences.structural.showCheckboxes;
  base.showTimeEstimates = preferences.cognitive.showTimers;

  if (preferences.cognitive.focusMode) {
    base.containerClasses.push("nc-focus-mode");
  }

  return base;
}

/**
 * Get the base strategy for a neurodiversity type.
 *
 * REFACTORED: Now delegates to ProfileRegistry instead of a switch chain.
 * Deep-clones to prevent mutation of the registered module's strategy.
 */
function getBaseStrategy(type: string): AdaptationStrategy {
  const mod = ProfileRegistry.get(type);
  if (mod) {
    return JSON.parse(JSON.stringify(mod.strategy));
  }

  // Fallback for unregistered types — use neurotypical
  const fallback = ProfileRegistry.get("neurotypical");
  if (fallback) {
    return JSON.parse(JSON.stringify(fallback.strategy));
  }

  // Absolute last resort (shouldn't happen if profiles are registered)
  return {
    cssVariables: {
      "--nc-font-size": "14px",
      "--nc-font-family": "'Segoe UI', system-ui, sans-serif",
      "--nc-line-height": "1.5",
      "--nc-letter-spacing": "0em",
      "--nc-paragraph-spacing": "1em",
      "--nc-max-width": "80ch",
      "--nc-bg-color": "#ffffff",
      "--nc-text-color": "#1f2937",
      "--nc-heading-color": "#111827",
      "--nc-accent-color": "#2563eb",
      "--nc-border-radius": "6px",
      "--nc-code-bg": "#f3f4f6",
    },
    containerClasses: ["nc-profile-neurotypical"],
    collapseCodeBlocks: false,
    addCheckboxes: false,
    insertDividers: false,
    addSummaryBoxes: false,
    maxParagraphLength: 500,
    showTimeEstimates: false,
  };
}
