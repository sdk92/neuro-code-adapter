/**
 * Built-in neurodiversity modules.
 *
 * Each module encapsulates everything about one profile:
 *   - Profile metadata & default preferences
 *   - Visual/structural strategy for the renderer
 *   - Rule-based offline adapter
 *   - LLM prompt fragment
 *
 * To add a new profile (e.g. dyscalculia), create a new module object
 * following this pattern and call ProfileRegistry.register(). No other
 * files need to change.
 */
import { ProfileRegistry } from "@shared/ProfileRegistry";
import type { NeurodiversityModule } from "@shared/ProfileRegistry";
import type {
  AdaptedSection,
  AssignmentSection,
  UserPreferences,
  VisualModification,
} from "@shared/types";
import type { AdaptationStrategy } from "./strategies";

// ─── Helper: default rule-based adapter (neurotypical) ──────────────────────

function neurotypicalAdapter(
  section: AssignmentSection,
  _prefs: UserPreferences
): AdaptedSection {
  return {
    originalSectionId: section.id,
    adaptedTitle: section.title,
    adaptedContent: section.content,
    visualModifications: [],
    structuralChanges: [],
  };
}

// ─── Neurotypical ───────────────────────────────────────────────────────────

const neurotypicalModule: NeurodiversityModule = {
  type: "neurotypical",

  profile: {
    type: "neurotypical",
    label: "Neurotypical",
    description: "Standard presentation with good readability and balanced structure.",
    defaultPreferences: {
      visual: {
        colorScheme: "default",
        fontSize: 14,
        fontFamily: "default",
        lineSpacing: 1.5,
        letterSpacing: 0,
        paragraphSpacing: 1.0,
        maxLineWidth: 80,
      },
      structural: {
        chunkSize: "large",
        progressiveDisclosure: false,
        showStepNumbers: true,
        showCheckboxes: false,
        bulletStyle: "bullets",
        sectionCollapsible: false,
        taskGranularity: "standard",
      },
      cognitive: {
        focusMode: false,
        textToSpeech: false,
        highlightCurrentStep: false,
        showTimers: false,
        breakReminders: false,
        breakIntervalMinutes: 45,
        simplifiedLanguage: false,
        showExamples: true,
      },
    },
  },

  strategy: {
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
  },

  ruleBasedAdapter: neurotypicalAdapter,

  promptFragment: `**Neurotypical:**
- Standard presentation with good readability
- Balanced structure and visual hierarchy
- Clear but not over-simplified language`,
};

// ─── Dyslexia ───────────────────────────────────────────────────────────────

const dyslexiaModule: NeurodiversityModule = {
  type: "dyslexia",

  profile: {
    type: "dyslexia",
    label: "Dyslexia",
    description:
      "Optimized for reading ease: larger fonts, increased spacing, " +
      "dyslexia-friendly typeface, shorter paragraphs, and visual anchors.",
    defaultPreferences: {
      visual: {
        colorScheme: "warm",
        fontSize: 16,
        fontFamily: "OpenDyslexic",
        lineSpacing: 2.0,
        letterSpacing: 0.05,
        paragraphSpacing: 1.5,
        maxLineWidth: 65,
      },
      structural: {
        chunkSize: "small",
        progressiveDisclosure: true,
        showStepNumbers: true,
        showCheckboxes: true,
        bulletStyle: "numbers",
        sectionCollapsible: true,
        taskGranularity: "detailed",
      },
      cognitive: {
        focusMode: false,
        textToSpeech: true,
        highlightCurrentStep: true,
        showTimers: false,
        breakReminders: false,
        breakIntervalMinutes: 30,
        simplifiedLanguage: true,
        showExamples: true,
      },
    },
  },

  strategy: {
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
  },

  ruleBasedAdapter(section: AssignmentSection, prefs: UserPreferences): AdaptedSection {
    const content = section.content.replace(/(.{200,}?\.)\s/g, "$1\n\n");
    const visualMods: VisualModification[] = [
      { type: "font", target: "body", value: prefs.visual.fontFamily || "OpenDyslexic" },
      { type: "spacing", target: "line-height", value: "1.8" },
      { type: "spacing", target: "letter-spacing", value: "0.05em" },
    ];
    return {
      originalSectionId: section.id,
      adaptedTitle: section.title,
      adaptedContent: content,
      visualModifications: visualMods,
      structuralChanges: ["Split long paragraphs", "Increased spacing"],
    };
  },

  promptFragment: `**Dyslexia:**
- Use shorter paragraphs and bullet points
- Increase white space between sections
- Avoid justified text alignment
- Use sans-serif fonts, larger font sizes
- Break complex instructions into numbered steps
- Add visual separators between logical blocks
- Use color coding for different types of information`,
};

// ─── Autism ─────────────────────────────────────────────────────────────────

const autismModule: NeurodiversityModule = {
  type: "autism",

  profile: {
    type: "autism",
    label: "Autism Spectrum",
    description:
      "Clear structure, precise language, consistent patterns, " +
      "explicit expectations, and reduced sensory complexity.",
    defaultPreferences: {
      visual: {
        colorScheme: "cool",
        fontSize: 14,
        fontFamily: "Atkinson Hyperlegible",
        lineSpacing: 1.6,
        letterSpacing: 0,
        paragraphSpacing: 1.2,
        maxLineWidth: 75,
      },
      structural: {
        chunkSize: "medium",
        progressiveDisclosure: false,
        showStepNumbers: true,
        showCheckboxes: true,
        bulletStyle: "numbers",
        sectionCollapsible: false,
        taskGranularity: "detailed",
      },
      cognitive: {
        focusMode: true,
        textToSpeech: false,
        highlightCurrentStep: true,
        showTimers: true,
        breakReminders: false,
        breakIntervalMinutes: 40,
        simplifiedLanguage: false,
        showExamples: true,
      },
    },
  },

  strategy: {
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
  },

  ruleBasedAdapter(section: AssignmentSection, _prefs: UserPreferences): AdaptedSection {
    const content = section.content.replace(/\n(#+\s)/g, "\n---\n$1");
    const visualMods: VisualModification[] = [
      { type: "border", target: "sections", value: "1px solid #ddd" },
      { type: "color", target: "headings", value: "#2c3e50" },
    ];
    return {
      originalSectionId: section.id,
      adaptedTitle: section.title,
      adaptedContent: content,
      visualModifications: visualMods,
      structuralChanges: ["Added section separators", "Explicit heading hierarchy"],
    };
  },

  promptFragment: `**Autism (ASD):**
- Use precise, literal language (avoid idioms and ambiguity)
- Provide explicit structure with clear headings
- Include concrete examples for every abstract concept
- Use consistent formatting patterns throughout
- Minimize sensory overload (reduce decorative elements)
- Provide clear success criteria and completion indicators
- Use checklists for multi-step tasks`,
};

// ─── ADHD ───────────────────────────────────────────────────────────────────

const adhdModule: NeurodiversityModule = {
  type: "adhd",

  profile: {
    type: "adhd",
    label: "ADHD",
    description:
      "Engagement-focused: small chunks, frequent checkpoints, " +
      "visual variety, time estimates, and break reminders.",
    defaultPreferences: {
      visual: {
        colorScheme: "pastel",
        fontSize: 15,
        fontFamily: "default",
        lineSpacing: 1.6,
        letterSpacing: 0,
        paragraphSpacing: 1.3,
        maxLineWidth: 70,
      },
      structural: {
        chunkSize: "small",
        progressiveDisclosure: true,
        showStepNumbers: true,
        showCheckboxes: true,
        bulletStyle: "icons",
        sectionCollapsible: true,
        taskGranularity: "standard",
      },
      cognitive: {
        focusMode: true,
        textToSpeech: false,
        highlightCurrentStep: true,
        showTimers: true,
        breakReminders: true,
        breakIntervalMinutes: 20,
        simplifiedLanguage: false,
        showExamples: true,
      },
    },
  },

  strategy: {
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
  },

  ruleBasedAdapter(section: AssignmentSection, _prefs: UserPreferences): AdaptedSection {
    const content = `> **Quick Summary:** ${section.title}\n\n${section.content}`;
    const visualMods: VisualModification[] = [
      { type: "highlight", target: "key-terms", value: "#fff3cd" },
      { type: "icon", target: "steps", value: "checkbox" },
    ];
    return {
      originalSectionId: section.id,
      adaptedTitle: section.title,
      adaptedContent: content,
      visualModifications: visualMods,
      structuralChanges: ["Added quick summary", "Added progress checkboxes"],
    };
  },

  promptFragment: `**ADHD:**
- Front-load key information (most important first)
- Break content into small, digestible chunks
- Add time estimates for each section
- Use visual variety (icons, colors, borders) to maintain engagement
- Include frequent progress checkpoints
- Provide "quick summary" boxes for each section
- Add interactive elements (checkboxes, expandable details)`,
};

// ─── Registration ───────────────────────────────────────────────────────────

/**
 * Register all built-in profiles.
 * Called once during extension activation.
 */
export function registerBuiltinProfiles(): void {
  ProfileRegistry.register(neurotypicalModule);
  ProfileRegistry.register(dyslexiaModule);
  ProfileRegistry.register(autismModule);
  ProfileRegistry.register(adhdModule);
}

/** Re-export individual modules for direct access in tests */
export {
  neurotypicalModule,
  dyslexiaModule,
  autismModule,
  adhdModule,
};
