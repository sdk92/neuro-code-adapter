/**
 * Tests for the heuristic PDF parser (Tier 2 offline fallback).
 *
 * The Tier 1 LLM path is covered by end-to-end testing; the heuristic
 * fallback is where deterministic behavior is possible, so this is where
 * we pin it down. These tests matter for the thesis Evaluation chapter:
 * "what happens when the API is unavailable?" needs a verifiable answer.
 *
 * Each test targets one of the four exported pure functions:
 *   - classifySectionTitle   (keyword → section type)
 *   - classifyLabel          (leading label word → section type)
 *   - inferDifficulty        (content complexity → difficulty)
 *   - structureViaHeuristics (raw text → Assignment)
 *   - validateAndNormalise   (untrusted object → Assignment)
 */
import {
  classifySectionTitle,
  classifyLabel,
  inferDifficulty,
  structureViaHeuristics,
  validateAndNormalise,
} from "../parser";

describe("classifySectionTitle", () => {
  it.each([
    ["Task 1: Build a calculator", "task"],
    ["Exercise: reverse a string", "task"],
    ["Implement the sort function", "task"],
    ["Hint: remember edge cases", "hint"],
    ["Tip — watch for overflow", "hint"],
    ["Example usage", "example"],
    ["Sample output", "example"],
    ["Reference: list of operators", "reference"],
    ["API glossary", "reference"],
    ["Introduction to the course", "instruction"],
    ["Overview", "instruction"],
  ])('title "%s" → type "%s"', (title, expected) => {
    expect(classifySectionTitle(title)).toBe(expected);
  });

  it("is case-insensitive on keywords", () => {
    expect(classifySectionTitle("TASK 1")).toBe("task");
    expect(classifySectionTitle("hint")).toBe("hint");
  });
});

describe("classifyLabel", () => {
  it.each([
    ["Task", "task"],
    ["Exercise", "task"],
    ["Step", "task"],
    ["Part", "task"],
    ["Hint", "hint"],
    ["Note", "hint"],
    ["Example", "example"],
    ["Reference", "reference"],
    ["Section", "instruction"],
    ["Random", "instruction"],
  ])('label "%s" → type "%s"', (label, expected) => {
    expect(classifyLabel(label)).toBe(expected);
  });
});

describe("inferDifficulty", () => {
  it("returns 'beginner' for plain text", () => {
    expect(inferDifficulty("Write a function that adds two numbers.")).toBe("beginner");
  });

  it("returns 'intermediate' when some complexity signals are present", () => {
    const text = "Implement a class using inheritance. Use an interface and an abstract method.";
    expect(inferDifficulty(text)).toBe("intermediate");
  });

  it("returns 'advanced' for heavy complexity signals", () => {
    const text = `
      Implement a thread-safe cache using generics and async/await.
      Apply the dependency injection design pattern.
      Include unit tests with mocks.
      Analyze the algorithm complexity (O(n log n)) of the recursion-based tree traversal.
      Use a hash data structure for lookups.
    `;
    expect(inferDifficulty(text)).toBe("advanced");
  });

  it("ignores case when matching signals", () => {
    expect(inferDifficulty("INHERITANCE POLYMORPHISM INTERFACE")).toBe("intermediate");
  });
});

describe("structureViaHeuristics", () => {
  describe("section detection", () => {
    it("splits on Markdown headings", () => {
      const text = "# Introduction\nWelcome to the course.\n\n## Task 1\nWrite a hello world.\n";
      const result = structureViaHeuristics(text, "test.pdf");
      const titles = result.sections.map((s) => s.title);
      expect(titles).toContain("Introduction");
      expect(titles).toContain("Task 1");
    });

    it("splits on numbered items at the start of a line", () => {
      // The numbered-match regex requires the item text on the same line as the number.
      // Each line becomes its own section title (the content follows on subsequent lines).
      const text =
        "1. First problem description here.\nDo thing A.\n\n" +
        "2. Second problem description here.\nDo thing B.\n\n" +
        "3. Third problem description here.\nDo thing C.\n";
      const result = structureViaHeuristics(text, "test.pdf");
      expect(result.sections.length).toBeGreaterThanOrEqual(3);
    });

    it("splits on labelled prefixes", () => {
      // flushSection only emits trailing sections if they accumulated content,
      // so we include a body line after each label.
      const text =
        "Task 1 - Build a calculator\nImplement add/subtract.\n\n" +
        "Hint: watch for overflow\nConsider using BigInt.\n";
      const result = structureViaHeuristics(text, "test.pdf");
      const types = result.sections.map((s) => s.type);
      expect(types).toContain("task");
      expect(types).toContain("hint");
    });

    it("classifies section types correctly", () => {
      const text = "# Task 1\nCode it.\n\n# Hint\nTry recursion.\n\n# Example\nprint(1)\n";
      const result = structureViaHeuristics(text, "test.pdf");
      const taskSection = result.sections.find((s) => s.title === "Task 1");
      const hintSection = result.sections.find((s) => s.title === "Hint");
      const exampleSection = result.sections.find((s) => s.title === "Example");
      expect(taskSection?.type).toBe("task");
      expect(hintSection?.type).toBe("hint");
      expect(exampleSection?.type).toBe("example");
    });

    it("emits at least one section even when text has no structure", () => {
      const text = "Just one paragraph of content with no headings.";
      const result = structureViaHeuristics(text, "plain.pdf");
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].content.length).toBeGreaterThan(0);
    });
  });

  describe("language detection", () => {
    it.each([
      ["def foo():\n    print('hi')", "Python"],
      ["const x = 1;\nconsole.log(x);", "JavaScript"],
      ["public class Main {\n  System.out.println();\n}", "Java"],
      ["namespace Demo {\n  Console.WriteLine();\n}", "C#"],
      ["interface Foo { x: number }\ntype Bar = string;", "TypeScript"],
    ])("detects language in %s snippet → %s", (code, expected) => {
      const result = structureViaHeuristics(code, "test.pdf");
      expect(result.metadata.language).toBe(expected);
    });

    it('falls back to "Unknown" for ambiguous text', () => {
      const result = structureViaHeuristics("Plain English text with no code.", "test.pdf");
      expect(result.metadata.language).toBe("Unknown");
    });
  });

  describe("metadata inference", () => {
    it("uses filename as title when no content headings are found", () => {
      // When there are no non-empty sections (all headings with empty content),
      // the filename is used as the title fallback.
      const result = structureViaHeuristics("", "my-assignment.pdf");
      expect(result.metadata.title).toBe("my-assignment");
    });

    it("sets difficulty based on content", () => {
      const result = structureViaHeuristics(
        "Implement a simple hello world function.",
        "test.pdf",
      );
      expect(result.metadata.difficulty).toBe("beginner");
    });

    it("estimates minutes from number of sections", () => {
      const text = "# S1\nCode it.\n# S2\nCode it.\n# S3\nCode it.\n";
      const result = structureViaHeuristics(text, "test.pdf");
      expect(result.metadata.estimatedMinutes).toBeGreaterThanOrEqual(15);
    });
  });

  describe("starter code extraction", () => {
    it("extracts fenced code block as starter code", () => {
      const text = "Here is the starter:\n```python\ndef solution():\n    pass\n```\nComplete it.";
      const result = structureViaHeuristics(text, "test.pdf");
      expect(result.starterCode).toContain("def solution()");
    });

    it("leaves starterCode undefined when no fenced block exists", () => {
      const result = structureViaHeuristics("No code here.", "test.pdf");
      expect(result.starterCode).toBeUndefined();
    });
  });
});

describe("validateAndNormalise", () => {
  const wellFormed = {
    metadata: {
      id: "csharp-calc-101",
      title: "Calculator",
      description: "Build a basic calculator.",
      author: "Dr. Kim",
      difficulty: "intermediate",
      estimatedMinutes: 120,
      language: "C#",
      tags: ["oop", "basics"],
    },
    sections: [
      {
        id: "section_0",
        title: "Background",
        content: "Calculators are fun.",
        type: "instruction",
        order: 0,
      },
    ],
    starterCode: "class Calculator { }",
  };

  it("accepts a well-formed assignment", () => {
    const result = validateAndNormalise(wellFormed, "calc.pdf");
    expect(result.metadata.title).toBe("Calculator");
    expect(result.sections).toHaveLength(1);
    expect(result.starterCode).toBe("class Calculator { }");
  });

  it("falls back to filename-derived title when title is missing", () => {
    const raw = {
      metadata: { difficulty: "beginner" },
      sections: [{ id: "s0", title: "Intro", content: "hi", type: "instruction", order: 0 }],
    };
    const result = validateAndNormalise(raw, "my-cool-assignment.pdf");
    expect(result.metadata.title).toBe("my-cool-assignment");
  });

  it("applies defaults for missing optional metadata fields", () => {
    const raw = {
      metadata: { title: "Test" },
      sections: [{ id: "s0", title: "Intro", content: "hi", type: "instruction", order: 0 }],
    };
    const result = validateAndNormalise(raw, "test.pdf");
    expect(result.metadata.author).toBe("Unknown");
    expect(result.metadata.language).toBe("Unknown");
    expect(result.metadata.difficulty).toBe("intermediate");
    expect(result.metadata.estimatedMinutes).toBe(60);
    expect(result.metadata.tags).toEqual([]);
  });

  it("rejects invalid section type (Zod schema is strict)", () => {
    // With the M2 Zod migration, invalid enum values are rejected rather than
    // silently coerced. This is a deliberate behavioural improvement: the
    // original hand-rolled validator would silently downgrade "bogus_type" to
    // "instruction", hiding LLM output drift. Zod surfaces the problem.
    const raw = {
      metadata: { title: "Test" },
      sections: [{ id: "s0", title: "X", content: "c", type: "bogus_type", order: 0 }],
    };
    expect(() => validateAndNormalise(raw, "test.pdf")).toThrow(/validation failed/i);
  });

  it("coerces numeric ids to strings", () => {
    const raw = {
      metadata: { title: "Test" },
      sections: [{ id: 42, title: "X", content: "c", type: "instruction", order: 0 }],
    };
    const result = validateAndNormalise(raw, "test.pdf");
    expect(result.sections[0].id).toBe("42");
  });

  it("throws on non-object input", () => {
    expect(() => validateAndNormalise(null, "test.pdf")).toThrow(/validation failed/i);
    expect(() => validateAndNormalise(42, "test.pdf")).toThrow(/validation failed/i);
    expect(() => validateAndNormalise("string", "test.pdf")).toThrow(/validation failed/i);
  });

  it("throws when sections array is empty", () => {
    expect(() =>
      validateAndNormalise(
        { metadata: { title: "Test" }, sections: [] },
        "test.pdf",
      ),
    ).toThrow(/at least one section/i);
  });

  it("throws when sections is not an array", () => {
    expect(() =>
      validateAndNormalise(
        { metadata: { title: "Test" }, sections: "not an array" },
        "test.pdf",
      ),
    ).toThrow(/validation failed/i);
  });
});
