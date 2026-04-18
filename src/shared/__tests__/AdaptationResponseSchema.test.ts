/**
 * Tests for AdaptationResponseSchema.
 *
 * These tests specifically cover the behaviors the old validateAdaptationResponse
 * had to hand-roll:
 *   - Missing/malformed top-level arrays → fail hard
 *   - Missing/malformed item fields → defaults applied (no silent empty strings)
 *   - Out-of-range confidenceScore → clamped
 *   - Extra unknown fields → tolerated (LLMs add cruft)
 *   - Enum violations on cosmetic fields → default instead of failing
 */
import { AdaptationResponseSchema } from "../schemas";

describe("AdaptationResponseSchema", () => {
  const validMinimal = {
    adaptedSections: [],
    reasoning: "test",
    confidenceScore: 0.8,
  };

  describe("happy paths", () => {
    it("accepts a minimal valid response", () => {
      const result = AdaptationResponseSchema.safeParse(validMinimal);
      expect(result.success).toBe(true);
    });

    it("accepts a full response", () => {
      const full = {
        adaptedSections: [
          {
            originalSectionId: "section_0",
            adaptedTitle: "Adapted Title",
            adaptedContent: "Content here.",
            visualModifications: [
              { type: "color", target: "body", value: "#ffffff" },
            ],
            structuralChanges: ["chunked into 3 parts"],
          },
        ],
        supportMessage: "You got this!",
        suggestedActions: [
          { type: "hint", message: "try step 1 first", priority: "high" },
        ],
        reasoning: "Student prefers structured tasks.",
        confidenceScore: 0.85,
      };
      const result = AdaptationResponseSchema.safeParse(full);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adaptedSections[0].visualModifications).toHaveLength(1);
        expect(result.data.suggestedActions).toHaveLength(1);
      }
    });
  });

  describe("structural failures (must reject)", () => {
    it("rejects non-object input", () => {
      expect(AdaptationResponseSchema.safeParse(null).success).toBe(false);
      expect(AdaptationResponseSchema.safeParse("not json").success).toBe(false);
      expect(AdaptationResponseSchema.safeParse(42).success).toBe(false);
    });

    it("rejects missing adaptedSections", () => {
      const result = AdaptationResponseSchema.safeParse({ reasoning: "x" });
      expect(result.success).toBe(false);
    });

    it("rejects non-array adaptedSections", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: "not an array",
        reasoning: "x",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("lenient coercion (old behaviour preserved)", () => {
    it("defaults adaptedTitle and adaptedContent when missing", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [{ originalSectionId: "s0" }],
        reasoning: "x",
        confidenceScore: 0.5,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adaptedSections[0].adaptedTitle).toBe("");
        expect(result.data.adaptedSections[0].adaptedContent).toBe("");
      }
    });

    it("defaults visualModifications and structuralChanges to empty arrays", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [{ originalSectionId: "s0" }],
        reasoning: "x",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adaptedSections[0].visualModifications).toEqual([]);
        expect(result.data.adaptedSections[0].structuralChanges).toEqual([]);
      }
    });

    it("coerces non-string originalSectionId to string", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [{ originalSectionId: 42 }],
        reasoning: "x",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adaptedSections[0].originalSectionId).toBe("42");
      }
    });

    it("defaults suggestedActions to empty array when missing", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [],
        reasoning: "x",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.suggestedActions).toEqual([]);
      }
    });

    it("clamps confidenceScore above 1", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [],
        reasoning: "x",
        confidenceScore: 5,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.confidenceScore).toBe(1);
      }
    });

    it("clamps confidenceScore below 0", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [],
        reasoning: "x",
        confidenceScore: -0.5,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.confidenceScore).toBe(0);
      }
    });

    it("defaults confidenceScore to 0.5 when invalid type", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [],
        reasoning: "x",
        confidenceScore: "not a number",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.confidenceScore).toBe(0.5);
      }
    });

    it("falls back priority to 'low' when invalid", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [],
        suggestedActions: [{ type: "hint", message: "tip", priority: "critical" }],
        reasoning: "x",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.suggestedActions[0].priority).toBe("low");
      }
    });

    it("falls back suggestedAction type to 'hint' when invalid", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [],
        suggestedActions: [{ type: "celebrate", message: "yay", priority: "high" }],
        reasoning: "x",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.suggestedActions[0].type).toBe("hint");
      }
    });

    it("tolerates extra unknown top-level fields (LLM cruft)", () => {
      const result = AdaptationResponseSchema.safeParse({
        adaptedSections: [],
        reasoning: "x",
        confidenceScore: 0.5,
        _debug: "internal model trace",
        extraField: { nested: true },
      });
      expect(result.success).toBe(true);
    });
  });
});
