/**
 * AdaptationEngine — Orchestrates LLM-based adaptive content generation.
 *
 * This is the intelligence core of NeuroCode Adapter. It:
 *   1. Assembles structured prompts from assignment content + user profile + session context
 *   2. Calls the LLM (via MCP tools or direct Anthropic API)
 *   3. Validates responses against the predefined AdaptationResponse schema
 *   4. Falls back to rule-based adaptation if LLM is unavailable
 *
 * The response schema ensures "consistency and interpretability of generated views"
 * as required by the project specification.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { McpManager } from "@services/mcp/McpManager";
import type {
  AdaptationRequest,
  AdaptationResponse,
  AdaptedSection,
  Assignment,
  NeurodiversityType,
  SessionContext,
  SuggestedAction,
  UserPreferences,
  VisualModification,
} from "@shared/types";
import { Logger } from "@shared/logger";
import { NEURODIVERSITY_PROFILES } from "@features/preferences/profiles";

// ─── System Prompt Template ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an adaptive learning assistant for the NeuroCode Adapter system.
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

Adaptation principles by neurodiversity type:

**Dyslexia:**
- Use shorter paragraphs and bullet points
- Increase white space between sections
- Avoid justified text alignment
- Use sans-serif fonts, larger font sizes
- Break complex instructions into numbered steps
- Add visual separators between logical blocks
- Use color coding for different types of information

**Autism (ASD):**
- Use precise, literal language (avoid idioms and ambiguity)
- Provide explicit structure with clear headings
- Include concrete examples for every abstract concept
- Use consistent formatting patterns throughout
- Minimize sensory overload (reduce decorative elements)
- Provide clear success criteria and completion indicators
- Use checklists for multi-step tasks

**ADHD:**
- Front-load key information (most important first)
- Break content into small, digestible chunks
- Add time estimates for each section
- Use visual variety (icons, colors, borders) to maintain engagement
- Include frequent progress checkpoints
- Provide "quick summary" boxes for each section
- Add interactive elements (checkboxes, expandable details)

**Neurotypical:**
- Standard presentation with good readability
- Balanced structure and visual hierarchy
- Clear but not over-simplified language`;

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildAdaptationPrompt(request: AdaptationRequest): string {
  const { assignment, userPreferences, sessionContext, requestType, targetSectionId } = request;
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

  // Include session context if available
  if (sessionContext) {
    prompt += `### Session Context:\n`;
    prompt += `- Time on task: ${Math.round(sessionContext.timeOnTask / 60_000)} minutes\n`;
    prompt += `- Total edits: ${sessionContext.editCount}\n`;
    prompt += `- Files worked on: ${sessionContext.filesSeen.length}\n`;

    if (sessionContext.struggleIndicators.length > 0) {
      prompt += `- Active struggles:\n`;
      for (const indicator of sessionContext.struggleIndicators.slice(-5)) {
        prompt += `  * ${indicator.type} (${indicator.severity}): ${indicator.context.details}\n`;
      }
    }
    prompt += "\n";
  }

  // Request type specific instructions
  switch (requestType) {
    case "full_adaptation":
      prompt += "Generate a complete adapted version of ALL sections.\n";
      break;
    case "section_adaptation":
      prompt += "Generate an adapted version of the specified section only.\n";
      break;
    case "help_request":
      prompt += "The student is asking for help. Provide supportive guidance without giving away the answer.\n";
      break;
  }

  prompt += "\nRespond with ONLY valid JSON matching the AdaptationResponse schema.";

  return prompt;
}

// ─── Response Validator ──────────────────────────────────────────────────────

function validateAdaptationResponse(raw: unknown): AdaptationResponse | null {
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
  private anthropicClient: Anthropic | null = null;
  private mcpManager: McpManager | null = null;
  private apiKey: string = "";

  /**
   * Initialize with Anthropic API key for direct LLM calls.
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    if (apiKey) {
      this.anthropicClient = new Anthropic({ apiKey });
      Logger.log("AdaptationEngine: Anthropic client initialized");
    }
  }

  /**
   * Set MCP manager for tool-based LLM interaction.
   */
  setMcpManager(mcpManager: McpManager): void {
    this.mcpManager = mcpManager;
  }

  /**
   * Generate an adapted view of assignment content.
   * Tries MCP first, falls back to direct API, then rule-based.
   */
  async generateAdaptation(request: AdaptationRequest): Promise<AdaptationResponse> {
    // Strategy 1: Use MCP server if connected
    if (this.mcpManager?.isConnected()) {
      try {
        return await this.generateViaMcp(request);
      } catch (error) {
        Logger.warn("MCP adaptation failed, falling back to direct API:", error);
      }
    }

    // Strategy 2: Use direct Anthropic API
    if (this.anthropicClient) {
      try {
        return await this.generateViaApi(request);
      } catch (error) {
        Logger.warn("API adaptation failed, falling back to rule-based:", error);
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
      sessionSummary: request.sessionContext,
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
   * Generate adaptation via direct Anthropic API call.
   */
  private async generateViaApi(request: AdaptationRequest): Promise<AdaptationResponse> {
    const prompt = buildAdaptationPrompt(request);

    const response = await this.anthropicClient!.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text in API response");
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = textBlock.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    const validated = validateAdaptationResponse(parsed);
    if (!validated) {
      throw new Error("Invalid adaptation response schema from API");
    }

    return validated;
  }

  /**
   * Rule-based adaptation fallback — no LLM needed.
   * Applies deterministic transformations based on neurodiversity profile.
   */
  private generateRuleBased(request: AdaptationRequest): AdaptationResponse {
    const { assignment, userPreferences } = request;
    const profileType = userPreferences.neurodiversityType;

    const adaptedSections: AdaptedSection[] = assignment.sections.map((section) => {
      let content = section.content;
      const visualMods: AdaptedSection["visualModifications"] = [];
      const structuralChanges: string[] = [];

      switch (profileType) {
        case "dyslexia":
          // Break long paragraphs into shorter ones
          content = content.replace(/(.{200,}?\.)\s/g, "$1\n\n");
          visualMods.push(
            { type: "font", target: "body", value: userPreferences.visual.fontFamily || "OpenDyslexic" },
            { type: "spacing", target: "line-height", value: "1.8" },
            { type: "spacing", target: "letter-spacing", value: "0.05em" },
          );
          structuralChanges.push("Split long paragraphs", "Increased spacing");
          break;

        case "autism":
          // Add explicit structure markers
          content = content.replace(/\n(#+\s)/g, "\n---\n$1");
          visualMods.push(
            { type: "border", target: "sections", value: "1px solid #ddd" },
            { type: "color", target: "headings", value: "#2c3e50" },
          );
          structuralChanges.push("Added section separators", "Explicit heading hierarchy");
          break;

        case "adhd":
          // Add summary markers and break into chunks
          content = `> **Quick Summary:** ${section.title}\n\n${content}`;
          visualMods.push(
            { type: "highlight", target: "key-terms", value: "#fff3cd" },
            { type: "icon", target: "steps", value: "checkbox" },
          );
          structuralChanges.push("Added quick summary", "Added progress checkboxes");
          break;

        default:
          // Neurotypical — minimal changes
          break;
      }

      return {
        originalSectionId: section.id,
        adaptedTitle: section.title,
        adaptedContent: content,
        visualModifications: visualMods,
        structuralChanges,
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
    this.anthropicClient = null;
    this.mcpManager = null;
  }
}
