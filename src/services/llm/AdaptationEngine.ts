/**
 * AdaptationEngine — Orchestrates LLM-based adaptive content generation.
 *
 * REFACTORED (M1): Prompt construction fully delegated to PromptBuilder.
 *   - SYSTEM_PROMPT_PREFIX removed (moved to resources/prompts/adaptation/system.md)
 *   - buildSystemPrompt / buildAdaptationPrompt removed (replaced by .buildSystemPrompt / .buildUserPrompt
 *     methods that compose templates via the builder)
 *   - Every AdaptationResponse now carries a BuildReceipt so evaluation telemetry
 *     can attribute outputs to specific template versions.
 *
 * Strategy chain (unchanged):
 *   MCP tool call → direct LlmProvider → rule-based fallback.
 *
 * Inspired by Cline's multi-provider architecture (ApiHandler / ApiProvider),
 * with the prompt layer swapped for a manifest-driven template store.
 */
import { z } from "zod";
import type { LlmProvider, LlmResponseBlock, LlmToolDef } from "./LlmProvider";
import type { McpManager } from "@services/mcp/McpManager";
import type {
  AdaptationRequest,
  AdaptationResponse,
  AdaptedSection,
} from "@shared/types";
import { AdaptationResponseSchema } from "@shared/schemas";
import { Logger } from "@shared/logger";
import { ProfileRegistry } from "@shared/ProfileRegistry";
import { NEURODIVERSITY_PROFILES } from "@features/preferences/profiles";
import { PromptBuilder, type BuildReceipt } from "@services/prompts";

// ─── Extended response type (carries prompt receipt) ─────────────────────────

/**
 * AdaptationResponse augmented with reproducibility metadata.
 * Non-breaking: existing consumers that ignore `.receipt` work unchanged.
 */
export interface AdaptationResponseWithReceipt extends AdaptationResponse {
  /** Templates that produced this adaptation — null for MCP/rule-based paths. */
  receipt?: BuildReceipt;
  /** Which strategy produced the response — useful for evaluation. */
  strategy: "mcp" | "provider" | "rule-based";
}

// ─── Response validator (M2: Zod-backed) ─────────────────────────────────────

/**
 * Validate an LLM-produced AdaptationResponse.
 *
 * REFACTORED (M2): Hand-rolled iteration, String(x ?? "") coercion, and
 * the `any` casts are gone. The AdaptationResponseSchema in @shared/schemas
 * is now the single source of truth for both the TypeScript type
 * (via z.infer) and the runtime shape. See docs/prompts.md for the
 * design rationale.
 */
export function validateAdaptationResponse(raw: unknown): AdaptationResponse | null {
  const result = AdaptationResponseSchema.safeParse(raw);
  if (!result.success) {
    Logger.warn(
      `AdaptationResponse validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    );
    return null;
  }
  return result.data;
}

export const ADAPTATION_TOOL_NAME = "submit_adaptation";

export function getAdaptationToolDefinition() {
  // Zod 4 → JSON Schema. Two options worth calling out:
  //   target: "draft-7"  — the dialect both Anthropic and OpenAI consume cleanly.
  //   io: "input"        — generate the schema for the *input* side of the
  //                        pipeline. AdaptationResponseSchema.confidenceScore
  //                        uses .transform() to clamp into [0, 1]; without
  //                        io:"input" that transform throws
  //                        "Transforms cannot be represented in JSON Schema".
  //                        The LLM sees a plain `number`; the clamp is re-applied
  //                        client-side when we Zod-parse the tool input.
  const inputSchema = z.toJSONSchema(AdaptationResponseSchema, {
    target: "draft-7",
    io: "input",
  }) as Record<string, unknown>;

  return {
    name: ADAPTATION_TOOL_NAME,
    description:
      "Submit the adapted assignment view. Call this tool exactly once with " +
      "the fully adapted content, visual modifications, and structural changes " +
      "tailored to the learner's neurodiversity profile. `confidenceScore` " +
      "should be between 0 and 1 inclusive. Do not include any prose before or " +
      "after the tool call — the tool input IS your complete response.",
    // Field name is `inputSchema` (camelCase) to satisfy LlmToolDef — providers
    // map to the API-specific name (`input_schema` for Anthropic, `parameters`
    // nested under `function` for OpenAI).
    inputSchema,
  };
}

export type AdaptationToolDefinition = ReturnType<typeof getAdaptationToolDefinition>;

// ─── Engine ──────────────────────────────────────────────────────────────────

export class AdaptationEngine {
  private provider: LlmProvider | null = null;
  private mcpManager: McpManager | null = null;
  private promptBuilder: PromptBuilder | null = null;

  /**
   * Inject the PromptBuilder. Must be called during activation, before
   * generateAdaptation() is invoked on the provider path. Without a builder,
   * provider-path adaptation will fall through to rule-based.
   */
  setPromptBuilder(builder: PromptBuilder): void {
    this.promptBuilder = builder;
    Logger.log("AdaptationEngine: PromptBuilder wired");
  }

  setProvider(provider: LlmProvider | null): void {
    this.provider = provider;
    if (provider) {
      Logger.log(`AdaptationEngine: provider set to ${provider.name} (${provider.model})`);
    }
  }

  setMcpManager(mcpManager: McpManager): void {
    this.mcpManager = mcpManager;
  }

  get isAvailable(): boolean {
    return this.provider !== null;
  }

  // ─── Prompt assembly (new) ─────────────────────────────────────────────────

  /**
   * Compose the system prompt from:
   *   1. Template "adaptation.system" (static base)
   *   2. ProfileRegistry's combined per-profile fragments (dynamic, runtime)
   *
   * Note on the hybrid: profile-specific fragments are *runtime-registered*
   * because adding a new profile requires code changes anyway (a ruleBasedAdapter
   * function). Moving their text into templates would scatter what's currently
   * co-located, so we accept the compromise: ProfileRegistry stays as-is,
   * its text is injected via withRawText() with attribution for the receipt.
   */
  private buildSystemPrompt(): { text: string; receipt: BuildReceipt } {
    if (!this.promptBuilder) {
      throw new Error("AdaptationEngine.buildSystemPrompt: PromptBuilder not wired");
    }
    const profileFragments = ProfileRegistry.buildCombinedPromptFragments();
    return this.promptBuilder
      .from("adaptation.system")
      .withRawText(profileFragments, { id: "profile.registry", version: "runtime" })
      .build();
  }

  /**
   * Compose the user prompt for a given adaptation request.
   * The fragment IDs are derived from the request — no if/else chains.
   */
  private buildUserPrompt(request: AdaptationRequest): { text: string; receipt: BuildReceipt } {
    if (!this.promptBuilder) {
      throw new Error("AdaptationEngine.buildUserPrompt: PromptBuilder not wired");
    }

    const { assignment, userPreferences, requestType, targetSectionId } = request;
    const profile = NEURODIVERSITY_PROFILES[userPreferences.neurodiversityType];

    const sections = targetSectionId
      ? assignment.sections.filter((s) => s.id === targetSectionId)
      : assignment.sections;

    const sectionContent = sections
      .map((s) => `## Section: ${s.title} (id: ${s.id}, type: ${s.type})\n${s.content}`)
      .join("\n\n---\n\n");

    const granularity = userPreferences.structural.taskGranularity;

    return this.promptBuilder
      .from("adaptation.user", {
        profileLabel: profile.label,
        assignmentTitle: assignment.metadata.title,
        language: assignment.metadata.language,
        difficulty: assignment.metadata.difficulty,
        sectionContent,
        fontSize: userPreferences.visual.fontSize,
        lineSpacing: userPreferences.visual.lineSpacing,
        chunkSize: userPreferences.structural.chunkSize,
        progressiveDisclosure: userPreferences.structural.progressiveDisclosure,
        simplifiedLanguage: userPreferences.cognitive.simplifiedLanguage,
        showExamples: userPreferences.cognitive.showExamples,
        granularity,
      })
      .withFragment(`adaptation.fragment.granularity.${granularity}`)
      .withFragment(`adaptation.fragment.request.${requestType}`)
      .build();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Generate an adapted view. Returns AdaptationResponseWithReceipt so callers
   * can log provenance. The return type is upcast-compatible with AdaptationResponse
   * for backward-compatibility with existing NeurocodeController code.
   */
  async generateAdaptation(request: AdaptationRequest): Promise<AdaptationResponseWithReceipt> {
    // Strategy 1: MCP server if connected
    if (this.mcpManager?.isConnected()) {
      try {
        const response = await this.generateViaMcp(request);
        return { ...response, strategy: "mcp" };
      } catch (error) {
        Logger.warn("MCP adaptation failed, falling back to direct provider:", error);
      }
    }

    // Strategy 2: Direct LLM provider
    if (this.provider && this.promptBuilder) {
      try {
        return await this.generateViaProvider(request);
      } catch (error) {
        Logger.warn("Provider adaptation failed, falling back to rule-based:", error);
      }
    }

    // Strategy 3: Rule-based fallback
    Logger.log("Using rule-based adaptation fallback");
    const response = this.generateRuleBased(request);
    return { ...response, strategy: "rule-based" };
  }

  private async generateViaMcp(request: AdaptationRequest): Promise<AdaptationResponse> {
    const result = await this.mcpManager!.callTool("adapt_assignment", {
      sectionContent: request.assignment.sections
        .map((s) => `## ${s.title}\n${s.content}`)
        .join("\n\n"),
      neurodiversityType: request.userPreferences.neurodiversityType,
      preferences: request.userPreferences,
    });

    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text content in MCP response");
    }

    const parsed = JSON.parse(textContent.text);
    const validated = validateAdaptationResponse(parsed);
    if (!validated) {
      throw new Error("Invalid adaptation response schema from MCP");
    }
    return validated;
  }

  private async generateViaProvider(request: AdaptationRequest): Promise<AdaptationResponseWithReceipt> {
    const { text: systemPrompt, receipt: systemReceipt } = this.buildSystemPrompt();
    const { text: userPrompt, receipt: userReceipt } = this.buildUserPrompt(request);

    const receipt: BuildReceipt = {
      manifestVersion: systemReceipt.manifestVersion,
      templates: [...systemReceipt.templates, ...userReceipt.templates],
    };

    const tool = getAdaptationToolDefinition();
    const response = await this.provider!.completeWithTools({
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 13784,
      tools: [tool],
      toolChoice: { type: "tool", name: tool.name },
    });

    if (response.stopReason === "max_tokens") {
      throw new Error("Response truncated: output exceeded max_tokens");
    }

    const toolUseBlock = response.content.find(
      (b): b is Extract<LlmResponseBlock, { type: "tool_use" }> => b.type === "tool_use"
    );

    if (!toolUseBlock) {
      throw new Error(
        `Model did not call the adaptation tool (stop_reason: ${response.stopReason})`
      );
    }

    const validated = validateAdaptationResponse(toolUseBlock.input);
    if (!validated) {
      throw new Error("Invalid adaptation response schema from provider tool call");
    }

    return { ...validated, strategy: "provider", receipt };
  }

  private generateRuleBased(request: AdaptationRequest): AdaptationResponse {
    const { assignment, userPreferences } = request;
    const profileType = userPreferences.neurodiversityType;
    const mod = ProfileRegistry.get(profileType);

    const adaptedSections: AdaptedSection[] = assignment.sections.map((section) => {
      if (mod) {
        return mod.ruleBasedAdapter(section, userPreferences);
      }
      return {
        originalSectionId: section.id,
        adaptedTitle: section.title,
        adaptedContent: section.content,
        visualModifications: [],
        structuralChanges: [],
      };
    });

    return {
      adaptedSections,
      supportMessage: undefined,
      suggestedActions: [],
      reasoning: `Rule-based adaptation applied for ${profileType} profile (LLM unavailable)`,
      confidenceScore: 0.6,
    };
  }

  dispose(): void {
    this.provider?.dispose();
    this.provider = null;
    this.mcpManager = null;
    this.promptBuilder = null;
  }
}
