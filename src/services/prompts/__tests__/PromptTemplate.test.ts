/**
 * Unit tests for PromptTemplate.
 *
 * These tests lock in the contract of the template system:
 *   - Variable substitution works with and without whitespace
 *   - Missing required vars are rejected (no silent empty-string substitution)
 *   - Unknown vars referenced in body are rejected (no silent "{{foo}}" in output)
 *   - Extra vars passed in are ignored without error
 *   - Metadata is preserved for telemetry
 */
import { PromptTemplate } from "../PromptTemplate";

describe("PromptTemplate", () => {
  const baseMeta = {
    id: "test.basic",
    version: "1.0.0",
    requiredVars: ["name", "count"] as const,
  };

  describe("rendering", () => {
    it("substitutes basic {{var}} placeholders", () => {
      const tpl = new PromptTemplate(baseMeta, "Hello {{name}}, you have {{count}} items.");
      expect(tpl.render({ name: "Alice", count: 3 })).toBe("Hello Alice, you have 3 items.");
    });

    it("tolerates whitespace inside braces", () => {
      const tpl = new PromptTemplate(baseMeta, "Hi {{ name }}, count={{  count  }}");
      expect(tpl.render({ name: "Bob", count: 5 })).toBe("Hi Bob, count=5");
    });

    it("stringifies non-string values", () => {
      const tpl = new PromptTemplate(baseMeta, "{{name}}={{count}}");
      expect(tpl.render({ name: "x", count: 42 })).toBe("x=42");
    });

    it("handles repeated placeholders", () => {
      const tpl = new PromptTemplate(baseMeta, "{{name}} {{name}} {{count}}");
      expect(tpl.render({ name: "a", count: 1 })).toBe("a a 1");
    });

    it("ignores extra vars that are not referenced", () => {
      const tpl = new PromptTemplate(baseMeta, "Hello {{name}}, count={{count}}");
      expect(tpl.render({ name: "x", count: 1, extra: "ignored" })).toBe("Hello x, count=1");
    });
  });

  describe("strict-mode contract", () => {
    it("throws when a required variable is missing", () => {
      const tpl = new PromptTemplate(baseMeta, "Hello {{name}}");
      expect(() => tpl.render({ name: "x" } as any)).toThrow(/missing required variable "count"/);
    });

    it("throws when body references an undeclared placeholder", () => {
      // Body has {{extra}} but it's not in requiredVars and not in provided vars.
      const tpl = new PromptTemplate(baseMeta, "Hi {{name}} {{count}} {{extra}}");
      expect(() => tpl.render({ name: "x", count: 1 })).toThrow(/unknown variable "extra"/);
    });

    it("does not throw if undeclared placeholder is passed explicitly", () => {
      // If the caller provides `extra`, the body's {{extra}} resolves.
      // The manifest contract (requiredVars) guards against *omissions*, not against over-provision.
      const tpl = new PromptTemplate(baseMeta, "{{name}} {{count}} {{extra}}");
      expect(tpl.render({ name: "a", count: 1, extra: "b" })).toBe("a 1 b");
    });
  });

  describe("introspection", () => {
    it("reports metadata", () => {
      const tpl = new PromptTemplate(baseMeta, "body");
      expect(tpl.id).toBe("test.basic");
      expect(tpl.version).toBe("1.0.0");
    });

    it("lists declared placeholders (for authoring round-trip checks)", () => {
      const tpl = new PromptTemplate(baseMeta, "{{a}} {{b}} {{a}} text");
      expect(tpl.declaredPlaceholders().sort()).toEqual(["a", "b"]);
    });
  });
});
