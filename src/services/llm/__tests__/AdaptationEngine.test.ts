import { AdaptationEngine, getAdaptationToolDefinition } from "../AdaptationEngine";
import type { LlmProvider, LlmToolCompletionParams, LlmToolResponse } from "../LlmProvider";
import type { AdaptationRequest } from "@shared/types";
import type { BuildReceipt, PromptBuilder } from "@services/prompts";
import { AssignmentSchema } from "@shared/schemas/assignment";
import { UserPreferencesSchema } from "@shared/schemas/preferences";
import { registerBuiltinProfiles } from "@features/adaptive/builtinProfiles";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_TOOL_INPUT = {
  adaptedSections: [
    {
      originalSectionId: "s1",
      adaptedTitle: "Intro",
      adaptedContent: "<p>Hello</p>",
      visualModifications: [],
      structuralChanges: [],
    },
  ],
  suggestedActions: [],
  reasoning: "Adapted for dyslexia",
  confidenceScore: 0.9,
};

const MOCK_REQUEST: AdaptationRequest = {
  assignment: AssignmentSchema.parse({
    metadata: { title: "Test Assignment", language: "python", difficulty: "beginner" },
    sections: [{ id: "s1", title: "Intro", content: "Hello world", type: "instruction", order: 0 }],
  }),
  userPreferences: UserPreferencesSchema.parse({
    neurodiversityType: "dyslexia",
    visual: {},
    structural: {},
    cognitive: {},
  }),
  requestType: "full_adaptation",
};

const MOCK_RECEIPT: BuildReceipt = { manifestVersion: "1.0.0", templates: [] };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProvider(
  overrides: Partial<{ toolInput: Record<string, unknown>; stopReason: string; throws: Error }>
): LlmProvider {
  return {
    name: "MockProvider",
    model: "mock-model",
    supportsDocumentInput: false,
    complete: jest.fn(),
    completeWithTools: jest.fn().mockImplementation(async (_params: LlmToolCompletionParams): Promise<LlmToolResponse> => {
      if (overrides.throws) { throw overrides.throws; }
      const stopReason = overrides.stopReason ?? "tool_use";
      const content = overrides.toolInput
        ? [{ type: "tool_use" as const, id: "tu_1", name: "submit_adaptation", input: overrides.toolInput }]
        : [{ type: "text" as const, text: "I forgot to call the tool." }];
      return { content, stopReason };
    }),
    dispose: jest.fn(),
  };
}

function makePromptBuilder(): PromptBuilder {
  return {
    from: jest.fn().mockReturnValue({
      withRawText: jest.fn().mockReturnThis(),
      withFragment: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ text: "mock prompt", receipt: MOCK_RECEIPT }),
    }),
  } as unknown as PromptBuilder;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AdaptationEngine — tool use path", () => {
  let engine: AdaptationEngine;

  beforeAll(() => {
    registerBuiltinProfiles();
  });

  beforeEach(() => {
    engine = new AdaptationEngine();
    engine.setPromptBuilder(makePromptBuilder());
  });

  it("returns validated adaptation when tool is called correctly", async () => {
    engine.setProvider(makeProvider({ toolInput: VALID_TOOL_INPUT }));
    const result = await engine.generateAdaptation(MOCK_REQUEST);

    expect(result.strategy).toBe("provider");
    expect(result.adaptedSections).toHaveLength(1);
    expect(result.adaptedSections[0].originalSectionId).toBe("s1");
    expect(result.confidenceScore).toBe(0.9);
  });

  it("passes toolChoice: { type: 'tool', name: 'submit_adaptation' } to provider", async () => {
    const provider = makeProvider({ toolInput: VALID_TOOL_INPUT });
    engine.setProvider(provider);
    await engine.generateAdaptation(MOCK_REQUEST);

    const call = (provider.completeWithTools as jest.Mock).mock.calls[0][0] as LlmToolCompletionParams;
    expect(call.toolChoice).toEqual({ type: "tool", name: "submit_adaptation" });
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe("submit_adaptation");
  });

  it("falls back to rule-based when model does not call the tool", async () => {
    // No toolInput → response has only a text block → provider path throws → rule-based kicks in
    engine.setProvider(makeProvider({}));
    const result = await engine.generateAdaptation(MOCK_REQUEST);

    expect(result.strategy).toBe("rule-based");
  });

  it("falls back to rule-based when stop_reason is max_tokens", async () => {
    engine.setProvider(makeProvider({ toolInput: VALID_TOOL_INPUT, stopReason: "max_tokens" }));
    const result = await engine.generateAdaptation(MOCK_REQUEST);

    expect(result.strategy).toBe("rule-based");
  });

  it("falls back to rule-based when tool input fails schema validation", async () => {
    const badInput = { adaptedSections: "not-an-array" };
    engine.setProvider(makeProvider({ toolInput: badInput }));
    const result = await engine.generateAdaptation(MOCK_REQUEST);

    expect(result.strategy).toBe("rule-based");
  });

  it("falls back to rule-based when provider throws", async () => {
    engine.setProvider(makeProvider({ throws: new Error("network error") }));
    const result = await engine.generateAdaptation(MOCK_REQUEST);

    expect(result.strategy).toBe("rule-based");
  });

  it("clamps confidenceScore to [0, 1]", async () => {
    engine.setProvider(makeProvider({ toolInput: { ...VALID_TOOL_INPUT, confidenceScore: 1.8 } }));
    const result = await engine.generateAdaptation(MOCK_REQUEST);

    expect(result.confidenceScore).toBe(1);
  });

  it("attaches a BuildReceipt with strategy='provider'", async () => {
    engine.setProvider(makeProvider({ toolInput: VALID_TOOL_INPUT }));
    const result = await engine.generateAdaptation(MOCK_REQUEST);

    expect(result.receipt).toBeDefined();
    expect(result.receipt?.manifestVersion).toBe("1.0.0");
  });
});

describe("getAdaptationToolDefinition", () => {
  it("returns a tool named submit_adaptation", () => {
    const def = getAdaptationToolDefinition();
    expect(def.name).toBe("submit_adaptation");
  });

  it("schema requires adaptedSections (only field without a default); optional fields are listed as properties", () => {
    const def = getAdaptationToolDefinition();
    const schema = def.inputSchema as { required: string[]; properties: Record<string, unknown> };
    // adaptedSections has no .default(...) → required.
    // suggestedActions, reasoning, confidenceScore all have .default(...) →
    // optional in the input-side JSON Schema, but still declared as properties
    // so the model knows it can populate them.
    expect(schema.required).toEqual(["adaptedSections"]);
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["adaptedSections", "suggestedActions", "reasoning", "confidenceScore"])
    );
  });
});
