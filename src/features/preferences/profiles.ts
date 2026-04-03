/**
 * Neurodiversity profile definitions.
 *
 * Each profile contains:
 *   - Type identifier
 *   - Human-readable label and description
 *   - Default preferences tuned for that profile's cognitive/perceptual needs
 *
 * These defaults follow Universal Design for Learning (UDL) principles
 * and neurodiversity-affirming education research.
 */
import type { NeurodiversityProfile, NeurodiversityType, UserPreferences } from "@shared/types";

export const NEURODIVERSITY_PROFILES: Record<NeurodiversityType, NeurodiversityProfile> = {
  neurotypical: {
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

  dyslexia: {
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

  autism: {
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

  adhd: {
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
};

/**
 * Get full default preferences for a neurodiversity type.
 */
export function getDefaultPreferences(type: NeurodiversityType): UserPreferences {
  const profile = NEURODIVERSITY_PROFILES[type];
  return {
    neurodiversityType: type,
    visual: profile.defaultPreferences.visual!,
    structural: profile.defaultPreferences.structural!,
    cognitive: profile.defaultPreferences.cognitive!,
  } as UserPreferences;
}
