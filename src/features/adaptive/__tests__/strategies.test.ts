/**
 * Tests for buildStrategy().
 *
 * buildStrategy is the function the AdaptiveRenderer calls on every render.
 * Its correctness determines whether a student sees their preferences honored.
 *
 * The function has two responsibilities:
 *   1. Look up a base strategy from ProfileRegistry (or fall back to neurotypical)
 *   2. Overlay user-specific preferences on top (font, spacing, focus mode, etc.)
 *
 * We test both independently, and we also test the interaction — specifically
 * that user overrides don't mutate the registered module's strategy (the reason
 * the implementation does a deep clone).
 */
import { buildStrategy } from "../strategies";
import { ProfileRegistry } from "@shared/ProfileRegistry";
import type { NeurodiversityModule } from "@shared/ProfileRegistry";
import type { UserPreferences } from "@shared/types";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeModule(type: string, strategyOverrides: Partial<NeurodiversityModule["strategy"]> = {}): NeurodiversityModule {
  return {
    type,
    profile: {
      type: type as any,
      label: type,
      description: "",
      defaultPreferences: {},
    },
    strategy: {
      cssVariables: {
        "--nc-font-size": "14px",
        "--nc-line-height": "1.5",
        "--nc-bg-color": "#ffffff",
        ...strategyOverrides.cssVariables,
      },
      containerClasses: strategyOverrides.containerClasses ?? [`nc-profile-${type}`],
      collapseCodeBlocks: strategyOverrides.collapseCodeBlocks ?? false,
      addCheckboxes: strategyOverrides.addCheckboxes ?? false,
      insertDividers: strategyOverrides.insertDividers ?? false,
      addSummaryBoxes: strategyOverrides.addSummaryBoxes ?? false,
      maxParagraphLength: strategyOverrides.maxParagraphLength ?? 500,
      showTimeEstimates: strategyOverrides.showTimeEstimates ?? false,
    },
    ruleBasedAdapter: (section, _prefs) => ({
      originalSectionId: section.id,
      adaptedTitle: section.title,
      adaptedContent: section.content,
      visualModifications: [],
      structuralChanges: [],
    }),
    promptFragment: "",
  };
}

function makePrefs(overrides: {
  neurodiversityType?: string;
  visual?: Partial<UserPreferences["visual"]>;
  structural?: Partial<UserPreferences["structural"]>;
  cognitive?: Partial<UserPreferences["cognitive"]>;
} = {}): UserPreferences {
  return {
    neurodiversityType: (overrides.neurodiversityType ?? "neurotypical") as any,
    visual: {
      colorScheme: "default",
      fontSize: 14,
      fontFamily: "default",
      lineSpacing: 1.5,
      letterSpacing: 0,
      paragraphSpacing: 1.0,
      maxLineWidth: 80,
      ...overrides.visual,
    },
    structural: {
      chunkSize: "medium",
      progressiveDisclosure: false,
      showStepNumbers: true,
      showCheckboxes: true,
      bulletStyle: "bullets",
      sectionCollapsible: false,
      taskGranularity: "standard",
      ...overrides.structural,
    },
    cognitive: {
      focusMode: false,
      textToSpeech: false,
      highlightCurrentStep: false,
      showTimers: false,
      breakReminders: false,
      breakIntervalMinutes: 25,
      simplifiedLanguage: false,
      showExamples: true,
      ...overrides.cognitive,
    },
  };
}

describe("buildStrategy", () => {
  beforeEach(() => {
    ProfileRegistry.clear();
    // Always register neurotypical as the baseline fallback.
    ProfileRegistry.register(makeModule("neurotypical"));
  });

  describe("base strategy lookup", () => {
    it("uses the module's base strategy when type is registered", () => {
      ProfileRegistry.register(
        makeModule("dyslexia", {
          cssVariables: { "--nc-font-family": "'OpenDyslexic'" },
          containerClasses: ["nc-profile-dyslexia"],
        }),
      );

      const strategy = buildStrategy(makePrefs({ visual: { fontSize: 14 }, neurodiversityType: "dyslexia" }));
      expect(strategy.cssVariables["--nc-font-family"]).toBe("'OpenDyslexic'");
      expect(strategy.containerClasses).toContain("nc-profile-dyslexia");
    });

    it("falls back to neurotypical when type is unregistered", () => {
      const strategy = buildStrategy(makePrefs({ neurodiversityType: "unknown-type" }));
      expect(strategy.containerClasses).toContain("nc-profile-neurotypical");
    });

    it("returns a hardcoded last-resort when even neurotypical is unregistered", () => {
      ProfileRegistry.clear();
      const strategy = buildStrategy(makePrefs());
      // Falls through to the hardcoded fallback in getBaseStrategy
      expect(strategy.cssVariables["--nc-font-size"]).toBe("14px");
      expect(strategy.containerClasses).toContain("nc-profile-neurotypical");
    });
  });

  describe("preference overrides", () => {
    it("applies visual.fontSize to --nc-font-size", () => {
      const strategy = buildStrategy(makePrefs({ visual: { fontSize: 20 } }));
      expect(strategy.cssVariables["--nc-font-size"]).toBe("20px");
    });

    it("applies visual.lineSpacing to --nc-line-height", () => {
      const strategy = buildStrategy(makePrefs({ visual: { lineSpacing: 2.0 } }));
      expect(strategy.cssVariables["--nc-line-height"]).toBe("2");
    });

    it("applies visual.letterSpacing to --nc-letter-spacing with em unit", () => {
      const strategy = buildStrategy(makePrefs({ visual: { letterSpacing: 0.05 } }));
      expect(strategy.cssVariables["--nc-letter-spacing"]).toBe("0.05em");
    });

    it("applies custom font family when not 'default'", () => {
      const strategy = buildStrategy(makePrefs({ visual: { fontFamily: "OpenDyslexic" } }));
      expect(strategy.cssVariables["--nc-font-family"]).toBe("'OpenDyslexic', sans-serif");
    });

    it("does not override font family when it is 'default'", () => {
      ProfileRegistry.register(
        makeModule("neurotypical", {
          cssVariables: { "--nc-font-family": "'Registered', sans-serif" },
        }),
      );
      const strategy = buildStrategy(makePrefs({ visual: { fontFamily: "default" } }));
      expect(strategy.cssVariables["--nc-font-family"]).toBe("'Registered', sans-serif");
    });

    it("syncs addCheckboxes with structural.showCheckboxes", () => {
      const strategy = buildStrategy(makePrefs({ structural: { showCheckboxes: true } }));
      expect(strategy.addCheckboxes).toBe(true);

      const strategy2 = buildStrategy(makePrefs({ structural: { showCheckboxes: false } }));
      expect(strategy2.addCheckboxes).toBe(false);
    });

    it("syncs showTimeEstimates with cognitive.showTimers", () => {
      const strategy = buildStrategy(makePrefs({ cognitive: { showTimers: true } }));
      expect(strategy.showTimeEstimates).toBe(true);
    });

    it("appends 'nc-focus-mode' class when focusMode is enabled", () => {
      const strategy = buildStrategy(makePrefs({ cognitive: { focusMode: true } }));
      expect(strategy.containerClasses).toContain("nc-focus-mode");
    });

    it("omits 'nc-focus-mode' class when focusMode is disabled", () => {
      const strategy = buildStrategy(makePrefs({ cognitive: { focusMode: false } }));
      expect(strategy.containerClasses).not.toContain("nc-focus-mode");
    });
  });

  describe("immutability of registered strategies", () => {
    it("does not mutate the registered module's strategy on subsequent calls", () => {
      const mod = makeModule("autism", { containerClasses: ["nc-profile-autism"] });
      ProfileRegistry.register(mod);

      // Call with focusMode → 'nc-focus-mode' gets pushed onto containerClasses
      const strategy1 = buildStrategy(makePrefs({
        neurodiversityType: "autism" as any,
        cognitive: { focusMode: true },
      }));
      expect(strategy1.containerClasses).toContain("nc-focus-mode");

      // Call again without focusMode — the registered module must still be pristine.
      const strategy2 = buildStrategy(makePrefs({
        neurodiversityType: "autism" as any,
        cognitive: { focusMode: false },
      }));
      expect(strategy2.containerClasses).not.toContain("nc-focus-mode");

      // Explicitly verify the registered strategy is untouched
      expect(mod.strategy.containerClasses).toEqual(["nc-profile-autism"]);
    });

    it("does not mutate cssVariables across calls", () => {
      const mod = makeModule("adhd");
      ProfileRegistry.register(mod);
      const originalSize = mod.strategy.cssVariables["--nc-font-size"];

      buildStrategy(makePrefs({
        neurodiversityType: "adhd" as any,
        visual: { fontSize: 24 },
      }));

      expect(mod.strategy.cssVariables["--nc-font-size"]).toBe(originalSize);
    });
  });
});
