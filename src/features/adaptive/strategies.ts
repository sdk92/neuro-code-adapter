/**
 * Adaptation strategies per neurodiversity profile.
 *
 * Each strategy defines CSS variables, structural transforms,
 * and content processing rules specific to a profile.
 * Used by AdaptiveRenderer to apply deterministic visual adaptations.
 */
import type { NeurodiversityType, UserPreferences } from "@shared/types";

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

function getBaseStrategy(type: NeurodiversityType): AdaptationStrategy {
  switch (type) {
    case "dyslexia":
      return {
        cssVariables: {
          "--nc-font-size": "16px",
          "--nc-font-family": "'OpenDyslexic', 'Comic Sans MS', sans-serif",
          "--nc-line-height": "2.0",
          "--nc-letter-spacing": "0.05em",
          "--nc-paragraph-spacing": "1.5em",
          "--nc-max-width": "65ch",
          "--nc-bg-color": "#fdf6e3",
          "--nc-text-color": "#333",
          "--nc-heading-color": "#2c3e50",
          "--nc-accent-color": "#e67e22",
          "--nc-border-radius": "8px",
          "--nc-code-bg": "#fef9ef",
        },
        containerClasses: ["nc-profile-dyslexia"],
        collapseCodeBlocks: false,
        addCheckboxes: true,
        insertDividers: true,
        addSummaryBoxes: false,
        maxParagraphLength: 200,
        showTimeEstimates: false,
      };

    case "autism":
      return {
        cssVariables: {
          "--nc-font-size": "14px",
          "--nc-font-family": "'Atkinson Hyperlegible', 'Segoe UI', sans-serif",
          "--nc-line-height": "1.6",
          "--nc-letter-spacing": "0em",
          "--nc-paragraph-spacing": "1.2em",
          "--nc-max-width": "75ch",
          "--nc-bg-color": "#f0f4f8",
          "--nc-text-color": "#2d3748",
          "--nc-heading-color": "#1a365d",
          "--nc-accent-color": "#3182ce",
          "--nc-border-radius": "4px",
          "--nc-code-bg": "#edf2f7",
        },
        containerClasses: ["nc-profile-autism"],
        collapseCodeBlocks: false,
        addCheckboxes: true,
        insertDividers: true,
        addSummaryBoxes: false,
        maxParagraphLength: 400,
        showTimeEstimates: true,
      };

    case "adhd":
      return {
        cssVariables: {
          "--nc-font-size": "15px",
          "--nc-font-family": "'Segoe UI', system-ui, sans-serif",
          "--nc-line-height": "1.6",
          "--nc-letter-spacing": "0em",
          "--nc-paragraph-spacing": "1.3em",
          "--nc-max-width": "70ch",
          "--nc-bg-color": "#fafafa",
          "--nc-text-color": "#374151",
          "--nc-heading-color": "#7c3aed",
          "--nc-accent-color": "#8b5cf6",
          "--nc-border-radius": "12px",
          "--nc-code-bg": "#f5f3ff",
        },
        containerClasses: ["nc-profile-adhd"],
        collapseCodeBlocks: true,
        addCheckboxes: true,
        insertDividers: true,
        addSummaryBoxes: true,
        maxParagraphLength: 150,
        showTimeEstimates: true,
      };

    default: // neurotypical
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
}
