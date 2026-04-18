/**
 * Unit tests for PromptBuilder.
 *
 * These tests pin down the Builder contract:
 *   - Fluent chaining composes templates in order
 *   - Fragment vars inherit from base vars
 *   - withOptionalFragment is a true no-op when missing
 *   - Build receipts list every contributing template with version
 *
 * The store is faked inline so tests don't touch the filesystem.
 */
import { PromptTemplate } from "../PromptTemplate";
import { PromptBuilder } from "../PromptBuilder";

/**
 * Minimal fake store — satisfies PromptBuilder's dependencies without fs.
 */
class FakeStore {
  private templates = new Map<string, PromptTemplate>();

  constructor(entries: Array<{ id: string; body: string; version?: string; requiredVars?: string[] }>) {
    for (const e of entries) {
      this.templates.set(
        e.id,
        new PromptTemplate(
          { id: e.id, version: e.version ?? "1.0.0", requiredVars: e.requiredVars ?? [] },
          e.body,
        ),
      );
    }
  }

  get(id: string): PromptTemplate {
    const t = this.templates.get(id);
    if (!t) { throw new Error(`FakeStore: unknown ${id}`); }
    return t;
  }

  has(id: string): boolean { return this.templates.has(id); }
  getIds(): string[] { return [...this.templates.keys()]; }
  getManifestVersion(): string { return "test-1.0.0"; }
}

function makeBuilder(entries: Array<{ id: string; body: string; version?: string; requiredVars?: string[] }>) {
  const store = new FakeStore(entries) as any;
  return { builder: new PromptBuilder(store), store };
}

describe("PromptBuilder", () => {
  describe("composition", () => {
    it("renders a base template alone", () => {
      const { builder } = makeBuilder([
        { id: "base", body: "Hello {{name}}", requiredVars: ["name"] },
      ]);
      const result = builder.from("base", { name: "World" }).buildText();
      expect(result).toBe("Hello World");
    });

    it("chains fragments in declaration order", () => {
      const { builder } = makeBuilder([
        { id: "base", body: "BASE" },
        { id: "frag.a", body: "FRAG_A" },
        { id: "frag.b", body: "FRAG_B" },
      ]);
      const result = builder
        .from("base")
        .withFragment("frag.a")
        .withFragment("frag.b")
        .buildText();
      expect(result).toBe("BASE\n\nFRAG_A\n\nFRAG_B");
    });

    it("fragments inherit base vars", () => {
      const { builder } = makeBuilder([
        { id: "base", body: "profile={{profile}}", requiredVars: ["profile"] },
        { id: "frag", body: "fragment sees profile={{profile}}", requiredVars: ["profile"] },
      ]);
      const result = builder
        .from("base", { profile: "adhd" })
        .withFragment("frag")
        .buildText();
      expect(result).toBe("profile=adhd\n\nfragment sees profile=adhd");
    });

    it("fragment extra vars override base vars", () => {
      const { builder } = makeBuilder([
        { id: "base", body: "x={{x}}", requiredVars: ["x"] },
        { id: "frag", body: "y={{x}}", requiredVars: ["x"] },
      ]);
      const result = builder
        .from("base", { x: "base-val" })
        .withFragment("frag", { x: "frag-val" })
        .buildText();
      expect(result).toBe("x=base-val\n\ny=frag-val");
    });

    it("withOptionalFragment is a no-op when template missing", () => {
      const { builder } = makeBuilder([{ id: "base", body: "BASE" }]);
      const result = builder
        .from("base")
        .withOptionalFragment("nonexistent")
        .buildText();
      expect(result).toBe("BASE");
    });

    it("withRawText injects literal content", () => {
      const { builder } = makeBuilder([{ id: "base", body: "BASE" }]);
      const result = builder
        .from("base")
        .withRawText("INJECTED")
        .buildText();
      expect(result).toBe("BASE\n\nINJECTED");
    });

    it("custom separator applies to joins", () => {
      const { builder } = makeBuilder([
        { id: "a", body: "A" },
        { id: "b", body: "B" },
      ]);
      const result = builder
        .from("a")
        .withFragment("b")
        .withSeparator(" | ")
        .buildText();
      expect(result).toBe("A | B");
    });
  });

  describe("receipts (for evaluation telemetry)", () => {
    it("lists every contributing template with its version", () => {
      const { builder } = makeBuilder([
        { id: "base", body: "BASE", version: "2.0.0" },
        { id: "frag.a", body: "A", version: "1.1.0" },
        { id: "frag.b", body: "B", version: "1.0.3" },
      ]);

      const { text, receipt } = builder
        .from("base")
        .withFragment("frag.a")
        .withFragment("frag.b")
        .build();

      expect(text).toBe("BASE\n\nA\n\nB");
      expect(receipt.manifestVersion).toBe("test-1.0.0");
      expect(receipt.templates).toEqual([
        { id: "base", version: "2.0.0" },
        { id: "frag.a", version: "1.1.0" },
        { id: "frag.b", version: "1.0.3" },
      ]);
    });

    it("includes attribution for raw text when provided", () => {
      const { builder } = makeBuilder([{ id: "base", body: "BASE" }]);
      const { receipt } = builder
        .from("base")
        .withRawText("runtime content", { id: "profile.registry", version: "runtime" })
        .build();
      expect(receipt.templates).toEqual([
        { id: "base", version: "1.0.0" },
        { id: "profile.registry", version: "runtime" },
      ]);
    });

    it("omits attribution for raw text when not provided", () => {
      const { builder } = makeBuilder([{ id: "base", body: "BASE" }]);
      const { receipt } = builder
        .from("base")
        .withRawText("anonymous")
        .build();
      expect(receipt.templates).toEqual([{ id: "base", version: "1.0.0" }]);
    });
  });

  describe("error propagation", () => {
    it("throws when base template is unknown", () => {
      const { builder } = makeBuilder([]);
      expect(() => builder.from("nope")).toThrow(/unknown/i);
    });

    it("throws when fragment is unknown (non-optional)", () => {
      const { builder } = makeBuilder([{ id: "base", body: "BASE" }]);
      expect(() => builder.from("base").withFragment("nope")).toThrow(/unknown/i);
    });

    it("propagates render errors with template id context", () => {
      const { builder } = makeBuilder([
        { id: "base", body: "{{missing}}", requiredVars: ["missing"] },
      ]);
      expect(() => builder.from("base", {})).toThrow(/missing required variable/);
    });
  });
});
