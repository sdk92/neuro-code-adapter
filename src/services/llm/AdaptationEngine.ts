/**
 * AdaptationEngine — Orchestrates LLM-based adaptive content generation.
 *
 * This is the intelligence core of NeuroCode Adapter. It:
 *   1. Assembles structured prompts from assignment content + user profile + session context
 *   2. Calls the LLM (via MCP tools or direct LlmProvider)
 *   3. Validates responses against the predefined AdaptationResponse schema
 *   4. Falls back to rule-based adaptation if LLM is unavailable
 *
 * REFACTORED: Now uses the LlmProvider abstraction instead of direct Anthropic SDK.
 * Any provider (Anthropic, OpenAI, Ollama, etc.) can be injected.
 */
import type { LlmProvider } from "./LlmProvider";
import type { McpManager } from "@services/mcp/McpManager";
import type {
  AdaptationRequest,
  AdaptationResponse,
  AdaptedSection,
  SuggestedAction,
  UserPreferences,
  VisualModification,
} from "@shared/types";
import { Logger } from "@shared/logger";
import { ProfileRegistry } from "@shared/ProfileRegistry";
import { NEURODIVERSITY_PROFILES } from "@features/preferences/profiles";

// ─── System Prompt Builder ───────────────────────────────────────────────────
// REFACTORED: Prompt fragments are now pulled from ProfileRegistry.
// Adding a new profile automatically extends the system prompt.

const SYSTEM_PROMPT_PREFIX = `You are an adaptive learning assistant for the NeuroCode Adapter system.
Your role is to transform programming assignment content to better support neurodiverse learners.

You MUST respond with valid JSON matching the AdaptationResponse schema:
{
  "adaptedSections": [
    {
      "originalSectionId": "string",
      "adaptedTitle": "string",
      "adaptedContent": "string (HTML/Markdown)",
      "visualModifications": [{ "type": "string", "target": "string", "value": "string" }],
      "structuralChanges": ["string"]
    }
  ],
  "supportMessage": "string (optional encouraging message)",
  "suggestedActions": [
    { "type": "string", "message": "string", "priority": "low|medium|high" }
  ],
  "reasoning": "string (explain WHY these adaptations were made)",
  "confidenceScore": 0.0-1.0
}

Adaptation principles by neurodiversity type:`;

function buildSystemPrompt(): string {
  const fragments = ProfileRegistry.buildCombinedPromptFragments();
  return `${SYSTEM_PROMPT_PREFIX}\n\n${fragments}`;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildAdaptationPrompt(request: AdaptationRequest): string {
  const { assignment, userPreferences, requestType, targetSectionId } = request;
  const profile = NEURODIVERSITY_PROFILES[userPreferences.neurodiversityType];

  const sections = targetSectionId
    ? assignment.sections.filter((s) => s.id === targetSectionId)
    : assignment.sections;

  const sectionContent = sections
    .map((s) => `## Section: ${s.title} (id: ${s.id}, type: ${s.type})\n${s.content}`)
    .join("\n\n---\n\n");

  let prompt = `Adapt the following programming assignment for a student with ${profile.label} profile.\n\n`;

  prompt += `### Assignment: ${assignment.metadata.title}\n`;
  prompt += `Language: ${assignment.metadata.language}\n`;
  prompt += `Difficulty: ${assignment.metadata.difficulty}\n\n`;

  prompt += `### Content to Adapt:\n${sectionContent}\n\n`;

  prompt += `### User Preferences:\n`;
  prompt += `- Font size: ${userPreferences.visual.fontSize}px\n`;
  prompt += `- Line spacing: ${userPreferences.visual.lineSpacing}\n`;
  prompt += `- Chunk size: ${userPreferences.structural.chunkSize}\n`;
  prompt += `- Progressive disclosure: ${userPreferences.structural.progressiveDisclosure}\n`;
  prompt += `- Simplified language: ${userPreferences.cognitive.simplifiedLanguage}\n`;
  prompt += `- Show examples: ${userPreferences.cognitive.showExamples}\n`;

  const granularity = userPreferences.structural.taskGranularity;
  prompt += `- Task granularity: ${granularity}\n`;
  if (granularity === "combined") {
    prompt += `  → Merge related task sections into broader milestones. Reduce the number of explicit steps; give the student a high-level goal and let them determine sub-steps themselves.\n`;
  } else if (granularity === "detailed") {
    prompt += `  → Break every task into the smallest possible atomic sub-steps. Each "What to do" item should be a single, concrete action. Add extra acceptance criteria so the student always knows when they are done.\n`;
  } else {
    prompt += `  → Keep the original task structure from the assignment without merging or splitting.\n`;
  }
  prompt += "\n";


  // Request type specific instructions
  switch (requestType) {
    case "full_adaptation":
      prompt += "Generate a complete adapted version of ALL sections according to the task granularity.\n";
      prompt += "Leave suggestedActions as an empty array [] — do NOT generate hints or suggestions.\n";
      break;
    case "help_request":
      prompt += "The student is asking for help. Provide supportive guidance without giving away the answer.\n";
      prompt += "You MUST populate suggestedActions with 2-3 items of type 'hint' or 'encouragement'. Do NOT leave suggestedActions empty.\n";
      break;
  }

  prompt += "\nRespond with ONLY valid JSON matching the AdaptationResponse schema.";

  return prompt;
}

// ─── Response Validator ──────────────────────────────────────────────────────

// REFACTORED: Exported for independent testing (previously private).
export function validateAdaptationResponse(raw: unknown): AdaptationResponse | null {
  if (!raw || typeof raw !== "object") { return null; }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.adaptedSections)) { return null; }

  const adaptedSections: AdaptedSection[] = [];
  for (const section of obj.adaptedSections) {
    if (typeof section !== "object" || !section) { continue; }
    const s = section as Record<string, unknown>;
    adaptedSections.push({
      originalSectionId: String(s.originalSectionId ?? ""),
      adaptedTitle: String(s.adaptedTitle ?? ""),
      adaptedContent: String(s.adaptedContent ?? ""),
      visualModifications: Array.isArray(s.visualModifications)
        ? s.visualModifications.map((v: any) => ({
            type: String(v.type ?? "") as VisualModification["type"],
            target: String(v.target ?? ""),
            value: String(v.value ?? ""),
          }))
        : [],
      structuralChanges: Array.isArray(s.structuralChanges)
        ? s.structuralChanges.map(String)
        : [],
    });
  }

  const suggestedActions: SuggestedAction[] = Array.isArray(obj.suggestedActions)
    ? obj.suggestedActions.map((a: any) => ({
        type: String(a.type ?? "hint") as SuggestedAction["type"],
        message: String(a.message ?? ""),
        priority: (["low", "medium", "high"].includes(a.priority) ? a.priority : "low") as SuggestedAction["priority"],
      }))
    : [];

  return {
    adaptedSections,
    supportMessage: typeof obj.supportMessage === "string" ? obj.supportMessage : undefined,
    suggestedActions,
    reasoning: String(obj.reasoning ?? "No reasoning provided"),
    confidenceScore: typeof obj.confidenceScore === "number"
      ? Math.max(0, Math.min(1, obj.confidenceScore))
      : 0.5,
  };
}

// ─── Engine Class ────────────────────────────────────────────────────────────

export class AdaptationEngine {
  private provider: LlmProvider | null = null;
  private mcpManager: McpManager | null = null;

  /**
   * Set the LLM provider for direct API calls.
   * REFACTORED: Replaces setApiKey() — now accepts any LlmProvider.
   */
  setProvider(provider: LlmProvider | null): void {
    this.provider = provider;
    if (provider) {
      Logger.log(`AdaptationEngine: provider set to ${provider.name} (${provider.model})`);
    }
  }

  /** Backward-compatible convenience — kept so callers that only have an API key still work. */
  get isAvailable(): boolean {
    return this.provider !== null;
  }

  /**
   * Set MCP manager for tool-based LLM interaction.
   */
  setMcpManager(mcpManager: McpManager): void {
    this.mcpManager = mcpManager;
  }

  /**
   * Generate an adapted view of assignment content.
   * Tries MCP first, falls back to direct provider, then rule-based.
   */
  async generateAdaptation(request: AdaptationRequest): Promise<AdaptationResponse> {
    // Strategy 1: Use MCP server if connected
    if (this.mcpManager?.isConnected()) {
      try {
        return await this.generateViaMcp(request);
      } catch (error) {
        Logger.warn("MCP adaptation failed, falling back to direct provider:", error);
      }
    }

    // Strategy 2: Use LLM provider
    if (this.provider) {
      try {
        return await this.generateViaProvider(request);
      } catch (error) {
        Logger.warn("Provider adaptation failed, falling back to rule-based:", error);
      }
    }

    // Strategy 3: Rule-based fallback (no LLM needed)
    Logger.log("Using rule-based adaptation fallback");
    return this.generateRuleBased(request);
  }

  /**
   * Generate adaptation via MCP tool call.
   */
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

  /**
   * Generate adaptation via LLM provider (provider-agnostic).
   * REFACTORED: Uses LlmProvider.complete() instead of direct Anthropic SDK.
   */
  private async generateViaProvider(request: AdaptationRequest): Promise<AdaptationResponse> {
    const prompt = buildAdaptationPrompt(request);

    const response = await this.provider!.complete({
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: prompt }],
      maxTokens: 64000,
    });

    if (response.stopReason === "max_tokens") {
      throw new Error("Response truncated: output exceeded max_tokens, JSON will be incomplete");
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = response.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    const validated = validateAdaptationResponse(parsed);
    if (!validated) {
      throw new Error("Invalid adaptation response schema from provider");
    }

    return validated;
  }

  /**
   * Rule-based adaptation fallback — no LLM needed.
   * Applies deterministic transformations based on neurodiversity profile.
   *
   * REFACTORED: Delegates to ProfileRegistry's ruleBasedAdapter.
   * Adding a new profile's rule-based adapter no longer requires editing this file.
   */
  private generateRuleBased(request: AdaptationRequest): AdaptationResponse {
    const { assignment, userPreferences } = request;
    const profileType = userPreferences.neurodiversityType;

    const mod = ProfileRegistry.get(profileType);

    const adaptedSections: AdaptedSection[] = assignment.sections.map((section) => {
      if (mod) {
        return mod.ruleBasedAdapter(section, userPreferences);
      }
      // Fallback for unregistered types — pass through unchanged
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
  }
}
