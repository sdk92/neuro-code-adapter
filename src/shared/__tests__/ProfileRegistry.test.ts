/**
 * Tests for ProfileRegistry.
 *
 * The registry is the extensibility point advisor wants preserved: adding
 * a new neurodiversity type should be one register() call, with every
 * subsystem auto-picking it up. These tests lock down that contract.
 */
import { ProfileRegistry } from "../ProfileRegistry";
import type { NeurodiversityModule } from "../ProfileRegistry";
import type {
  AdaptedSection,
  AssignmentSection,
  UserPreferences,
} from "../types";

// ─── Test module factory ─────────────────────────────────────────────────────

function makeModule(
  type: string,
  overrides: Partial<NeurodiversityModule> = {},
): NeurodiversityModule {
  const passThrough = (section: AssignmentSection, _prefs: UserPreferences): AdaptedSection => ({
    originalSectionId: section.id,
    adaptedTitle: section.title,
    adaptedContent: section.content,
    visualModifications: [],
    structuralChanges: [],
  });

  return {
    type,
    profile: {
      type: type as any,
      label: `Label-${type}`,
      description: `Description for ${type}`,
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
          chunkSize: "medium",
          progressiveDisclosure: false,
          showStepNumbers: true,
          showCheckboxes: true,
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
          breakIntervalMinutes: 25,
          simplifiedLanguage: false,
          showExamples: true,
        },
      },
    },
    strategy: {
      cssVariables: { "--nc-test": type },
      containerClasses: [`nc-profile-${type}`],
      collapseCodeBlocks: false,
      addCheckboxes: false,
      insertDividers: false,
      addSummaryBoxes: false,
      maxParagraphLength: 500,
      showTimeEstimates: false,
    },
    ruleBasedAdapter: passThrough,
    promptFragment: `PROMPT for ${type}`,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ProfileRegistry", () => {
  beforeEach(() => {
    ProfileRegistry.clear();
  });

  describe("register / get", () => {
    it("registers and retrieves a module", () => {
      const mod = makeModule("dyslexia");
      ProfileRegistry.register(mod);
      expect(ProfileRegistry.get("dyslexia")).toBe(mod);
    });

    it("returns undefined for unknown type", () => {
      expect(ProfileRegistry.get("unknown")).toBeUndefined();
    });

    it("overwrites existing module with same type key", () => {
      const first = makeModule("adhd", { promptFragment: "FIRST" });
      const second = makeModule("adhd", { promptFragment: "SECOND" });
      ProfileRegistry.register(first);
      ProfileRegistry.register(second);
      expect(ProfileRegistry.get("adhd")?.promptFragment).toBe("SECOND");
    });
  });

  describe("getOrThrow", () => {
    it("returns the module when registered", () => {
      const mod = makeModule("autism");
      ProfileRegistry.register(mod);
      expect(ProfileRegistry.getOrThrow("autism")).toBe(mod);
    });

    it("throws with a helpful message when unknown, listing available types", () => {
      ProfileRegistry.register(makeModule("neurotypical"));
      ProfileRegistry.register(makeModule("dyslexia"));
      expect(() => ProfileRegistry.getOrThrow("dyscalculia")).toThrow(/dyscalculia/);
      expect(() => ProfileRegistry.getOrThrow("dyscalculia")).toThrow(/neurotypical/);
      expect(() => ProfileRegistry.getOrThrow("dyscalculia")).toThrow(/dyslexia/);
    });
  });

  describe("getAll / getTypes", () => {
    it("returns empty collections when nothing is registered", () => {
      expect(ProfileRegistry.getAll()).toEqual([]);
      expect(ProfileRegistry.getTypes()).toEqual([]);
    });

    it("returns every registered module and its type key", () => {
      ProfileRegistry.register(makeModule("a"));
      ProfileRegistry.register(makeModule("b"));
      ProfileRegistry.register(makeModule("c"));
      expect(ProfileRegistry.getAll()).toHaveLength(3);
      expect(ProfileRegistry.getTypes().sort()).toEqual(["a", "b", "c"]);
    });
  });

  describe("getAllProfiles / getAllStrategies", () => {
    it("exposes profiles keyed by type", () => {
      ProfileRegistry.register(makeModule("dyslexia"));
      ProfileRegistry.register(makeModule("autism"));
      const profiles = ProfileRegistry.getAllProfiles();
      expect(profiles.dyslexia.label).toBe("Label-dyslexia");
      expect(profiles.autism.label).toBe("Label-autism");
    });

    it("exposes strategies keyed by type", () => {
      ProfileRegistry.register(makeModule("dyslexia"));
      const strategies = ProfileRegistry.getAllStrategies();
      expect(strategies.dyslexia.cssVariables["--nc-test"]).toBe("dyslexia");
    });
  });

  describe("buildCombinedPromptFragments", () => {
    it("returns empty string when no modules are registered", () => {
      expect(ProfileRegistry.buildCombinedPromptFragments()).toBe("");
    });

    it("joins every registered module's promptFragment with double newline", () => {
      ProfileRegistry.register(makeModule("a", { promptFragment: "FRAG_A" }));
      ProfileRegistry.register(makeModule("b", { promptFragment: "FRAG_B" }));
      const combined = ProfileRegistry.buildCombinedPromptFragments();
      expect(combined).toContain("FRAG_A");
      expect(combined).toContain("FRAG_B");
      expect(combined).toMatch(/FRAG_A.*FRAG_B/s);
    });
  });

  describe("getDefaultPreferences", () => {
    it("returns preferences with the type key set correctly", () => {
      ProfileRegistry.register(makeModule("adhd"));
      const prefs = ProfileRegistry.getDefaultPreferences("adhd");
      expect(prefs.neurodiversityType).toBe("adhd");
      expect(prefs.visual.fontSize).toBe(14);
      expect(prefs.structural.taskGranularity).toBe("standard");
    });

    it("throws for unknown type", () => {
      expect(() => ProfileRegistry.getDefaultPreferences("nonexistent")).toThrow(/nonexistent/);
    });
  });

  describe("clear", () => {
    it("removes every registered module", () => {
      ProfileRegistry.register(makeModule("a"));
      ProfileRegistry.register(makeModule("b"));
      ProfileRegistry.clear();
      expect(ProfileRegistry.getAll()).toEqual([]);
    });
  });

  describe("ruleBasedAdapter invocation", () => {
    it("module's adapter is invoked when retrieved", () => {
      const adapter = jest.fn((section: AssignmentSection, _prefs: UserPreferences): AdaptedSection => ({
        originalSectionId: section.id,
        adaptedTitle: "CUSTOM",
        adaptedContent: section.content,
        visualModifications: [],
        structuralChanges: [],
      }));

      const mod = makeModule("custom", { ruleBasedAdapter: adapter });
      ProfileRegistry.register(mod);

      const section: AssignmentSection = {
        id: "s0",
        title: "Original",
        content: "Content",
        type: "instruction",
        order: 0,
      };
      const retrieved = ProfileRegistry.getOrThrow("custom");
      const result = retrieved.ruleBasedAdapter(section, {} as UserPreferences);

      expect(adapter).toHaveBeenCalledWith(section, expect.any(Object));
      expect(result.adaptedTitle).toBe("CUSTOM");
    });
  });
});
