/**
 * Tests for the PDF assignment parser.
 *
 * Coverage:
 *   - Tier 2 heuristic fallback (classifySectionTitle, classifyLabel,
 *     inferDifficulty, structureViaHeuristics) — deterministic, extensively
 *     pinned down for thesis Evaluation.
 *   - validateAndNormalise (Zod-backed, untrusted input → Assignment).
 *   - Tier 1 tool-use path — end-to-end LLM calls are not replayed here,
 *     but the pseudo-tool definition and parseAssignmentFile's branching
 *     logic (tool_use present / missing / malformed / truncated) are mocked
 *     and verified. Mirrors AdaptationEngine.test.ts in structure.
 */
import {
  classifySectionTitle,
  classifyLabel,
  inferDifficulty,
  structureViaHeuristics,
  validateAndNormalise,
  parseAssignmentFile,
  getAssignmentToolDefinition,
  ASSIGNMENT_TOOL_NAME,
} from "../parser";
import type {
  LlmProvider,
  LlmToolCompletionParams,
  LlmToolResponse,
} from "@services/llm/LlmProvider";
import type { PromptBuilder } from "@services/prompts";

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

// ─── Tier 1 tool-use path ────────────────────────────────────────────────────

describe("getAssignmentToolDefinition", () => {
  it("returns a tool named submit_assignment", () => {
    const def = getAssignmentToolDefinition();
    expect(def.name).toBe(ASSIGNMENT_TOOL_NAME);
    expect(def.name).toBe("submit_assignment");
  });

  it("schema has `metadata` and `sections` as required properties", () => {
    const def = getAssignmentToolDefinition();
    const schema = def.inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    // AssignmentSchema has no default on these two roots, so they're required.
    // starterCode / testCases / adaptationHints are optional.
    expect(schema.required).toEqual(
      expect.arrayContaining(["metadata", "sections"]),
    );
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        "metadata",
        "sections",
        "starterCode",
        "testCases",
      ]),
    );
  });

  it("produces a JSON Schema convertible to string (no transform errors)", () => {
    // Regression guard: ensures AssignmentSchema stays free of constructs
    // that z.toJSONSchema can't represent on the input side (e.g. .transform
    // without io:"input"). Matches the class of bug that previously broke
    // AdaptationEngine silently.
    const def = getAssignmentToolDefinition();
    expect(() => JSON.stringify(def.inputSchema)).not.toThrow();
  });
});

// ─── parseAssignmentFile (Tier 1) branching ─────────────────────────────────

const VALID_TOOL_INPUT = {
  metadata: {
    id: "hello-world-101",
    title: "Hello World",
    description: "Introductory exercise.",
    author: "Dr. Tester",
    difficulty: "beginner",
    estimatedMinutes: 15,
    language: "Python",
    tags: ["intro"],
  },
  sections: [
    {
      id: "section_0",
      title: "Introduction",
      content: "Welcome.",
      type: "instruction",
      order: 0,
    },
  ],
};

function makeProvider(
  overrides: Partial<{
    toolInput: Record<string, unknown>;
    stopReason: string;
    throws: Error;
    supportsDocumentInput: boolean;
  }> = {},
): LlmProvider {
  return {
    name: "MockProvider",
    model: "mock-model",
    supportsDocumentInput: overrides.supportsDocumentInput ?? true,
    complete: jest.fn(),
    completeWithTools: jest
      .fn()
      .mockImplementation(
        async (
          _params: LlmToolCompletionParams,
        ): Promise<LlmToolResponse> => {
          if (overrides.throws) {
            throw overrides.throws;
          }
          const stopReason = overrides.stopReason ?? "tool_use";
          const content = overrides.toolInput
            ? [
                {
                  type: "tool_use" as const,
                  id: "tu_1",
                  name: ASSIGNMENT_TOOL_NAME,
                  input: overrides.toolInput,
                },
              ]
            : [{ type: "text" as const, text: "I forgot to call the tool." }];
          return { content, stopReason };
        },
      ),
    dispose: jest.fn(),
  };
}

function makePromptBuilder(): PromptBuilder {
  return {
    from: jest.fn().mockReturnValue({
      buildText: jest.fn().mockReturnValue("mock prompt"),
    }),
  } as unknown as PromptBuilder;
}

/**
 * Minimal PDF buffer — pdf-parse never runs on the Tier 1 path, so the
 * contents are irrelevant. Tier 2 fallback does call pdf-parse, which
 * is what we exercise in the "falls back" tests.
 */
const FAKE_PDF = Buffer.from("%PDF-1.4\n%fake\n");

describe("parseAssignmentFile — Tier 1 tool-use path", () => {
  it("returns the validated assignment when the model calls submit_assignment", async () => {
    const provider = makeProvider({ toolInput: VALID_TOOL_INPUT });
    const result = await parseAssignmentFile(
      FAKE_PDF,
      "hello.pdf",
      provider,
      makePromptBuilder(),
    );

    expect(result.metadata.title).toBe("Hello World");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].id).toBe("section_0");
    expect(provider.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it("sends toolChoice: { type: 'tool', name: 'submit_assignment' }", async () => {
    const provider = makeProvider({ toolInput: VALID_TOOL_INPUT });
    await parseAssignmentFile(
      FAKE_PDF,
      "hello.pdf",
      provider,
      makePromptBuilder(),
    );

    const call = (provider.completeWithTools as jest.Mock).mock
      .calls[0][0] as LlmToolCompletionParams;
    expect(call.toolChoice).toEqual({
      type: "tool",
      name: ASSIGNMENT_TOOL_NAME,
    });
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe(ASSIGNMENT_TOOL_NAME);
  });

  it("falls back to Tier 2 heuristics when the model returns only text", async () => {
    // No toolInput → provider returns a text block → Tier 1 throws →
    // parseAssignmentFile catches it and tries pdf-parse. With our fake PDF
    // buffer pdf-parse will fail too, so we assert the error message names
    // the Tier 2 tool — that's evidence the fallback branch ran.
    const provider = makeProvider({});
    await expect(
      parseAssignmentFile(FAKE_PDF, "hello.pdf", provider, makePromptBuilder()),
    ).rejects.toThrow(/Failed to parse PDF/);
  });

  it("falls back to Tier 2 when stopReason is max_tokens", async () => {
    const provider = makeProvider({
      toolInput: VALID_TOOL_INPUT,
      stopReason: "max_tokens",
    });
    await expect(
      parseAssignmentFile(FAKE_PDF, "hello.pdf", provider, makePromptBuilder()),
    ).rejects.toThrow(/Failed to parse PDF/);
  });

  it("falls back to Tier 2 when tool input fails schema validation", async () => {
    const badInput = { metadata: { title: "X" }, sections: [] }; // empty sections violates .min(1)
    const provider = makeProvider({ toolInput: badInput });
    await expect(
      parseAssignmentFile(FAKE_PDF, "hello.pdf", provider, makePromptBuilder()),
    ).rejects.toThrow(/Failed to parse PDF/);
  });

  it("falls back to Tier 2 when the provider throws", async () => {
    const provider = makeProvider({ throws: new Error("network error") });
    await expect(
      parseAssignmentFile(FAKE_PDF, "hello.pdf", provider, makePromptBuilder()),
    ).rejects.toThrow(/Failed to parse PDF/);
  });

  it("skips Tier 1 when provider.supportsDocumentInput is false", async () => {
    // Should never call completeWithTools, goes straight to Tier 2.
    const provider = makeProvider({ supportsDocumentInput: false });
    await expect(
      parseAssignmentFile(FAKE_PDF, "hello.pdf", provider, makePromptBuilder()),
    ).rejects.toThrow(/Failed to parse PDF/);
    expect(provider.completeWithTools).not.toHaveBeenCalled();
  });
});

