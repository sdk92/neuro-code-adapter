/**
 * ScaffoldEngine — Agentic loop for project scaffolding.
 *
 * REFACTORED: Tool dispatch now uses ScaffoldToolRegistry instead of
 * a hardcoded switch chain. The engine doesn't know about specific tools —
 * it looks them up by name and calls their unified interface.
 *
 * Adding a new tool no longer requires editing this file.
 *
 * Inspired by Claude Code's query.ts agentic loop:
 *   while (true) {
 *     const response = await api.createMessage(...)
 *     if (stop_reason === "end_turn") break
 *     if (stop_reason === "tool_use") {
 *       await executeTools(response)  // dispatch via registry
 *     }
 *   }
 */
import * as vscode from "vscode";
import type { LlmProvider, LlmMessage, LlmResponseBlock } from "@services/llm/LlmProvider";
import { ScaffoldToolRegistry } from "./ScaffoldToolRegistry";
import { buildToolsForAssignment } from "./ScaffoldToolBuilder";
import { disposeExecutor } from "./tools";
import type { ScaffoldRequest, ToolExecutionContext, ToolExecutionResult } from "@shared/types";
import { Logger } from "@shared/logger";

const MAX_ITERATIONS = 20;

type ProgressCallback = (message: string, isDone: boolean) => void;

export class ScaffoldEngine implements vscode.Disposable {
  private provider: LlmProvider | undefined;
  private inProgress = false;

  /**
   * Set the LLM provider for the agentic loop.
   * REFACTORED: Replaces setApiKey() — now accepts any LlmProvider.
   */
  setProvider(provider: LlmProvider | undefined): void {
    this.provider = provider;
  }

  get isAvailable(): boolean {
    return !!this.provider;
  }

  /**
   * Run the scaffolding agentic loop.
   */
  async run(request: ScaffoldRequest, onProgress: ProgressCallback): Promise<void> {
    if (!this.provider) {
      throw new Error("No LLM provider configured. Set provider in VS Code settings.");
    }
    if (this.inProgress) {
      throw new Error("Scaffolding already in progress.");
    }

    this.inProgress = true;

    try {
      await this.agenticLoop(request, onProgress);
    } finally {
      this.inProgress = false;
    }
  }

  private async agenticLoop(request: ScaffoldRequest, onProgress: ProgressCallback): Promise<void> {
    const { tools, systemHint } = buildToolsForAssignment(request.assignment);

    const toolPrompts = ScaffoldToolRegistry.buildPromptFragments();

    const systemPrompt = [
      "You are NeuroCode Scaffold, a programming tutor assistant that creates project skeletons for students.",
      systemHint,
      "",
      "Think step by step. Use tools one at a time. Do not explain yourself — just call tools.",
      "Rules for the agentic loop:",
      toolPrompts,
    ].join("\n");

    const userMessage = buildScaffoldPrompt(request);

    // Provider-agnostic message history
    const messages: LlmMessage[] = [
      { role: "user", content: userMessage },
    ];

    onProgress("Starting scaffolding...", false);

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.provider!.completeWithTools({
        system: systemPrompt,
        messages,
        tools,
        maxTokens: 4096,
      });

      Logger.log(`[ScaffoldEngine] Iteration ${i + 1}, stop_reason: ${response.stopReason}`);

      const toolUseBlocks = response.content.filter(
        (b): b is Extract<LlmResponseBlock, { type: "tool_use" }> => b.type === "tool_use"
      );

      if (response.stopReason === "end_turn" || toolUseBlocks.length === 0) {
        onProgress("Scaffolding complete.", true);
        break;
      }

      // Append assistant response to history (preserve all content blocks)
      messages.push({
        role: "assistant",
        content: response.content.map((b) => {
          if (b.type === "tool_use") {
            return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
          }
          return { type: "text" as const, text: b.text };
        }),
      });

      // Execute tools and collect results
      const toolResultParts: Array<{ type: "tool_result"; toolUseId: string; content: string }> = [];

      for (const block of toolUseBlocks) {
        const result = await this.executeTool(block, request.workspaceRoot, onProgress);
        toolResultParts.push({
          type: "tool_result",
          toolUseId: block.id,
          content: result.success ? result.output : `ERROR: ${result.error}`,
        });

        if (!result.success) {
          Logger.warn(`[ScaffoldEngine] Tool ${block.name} failed: ${result.error}`);
        }
      }

      messages.push({ role: "user", content: toolResultParts });
    }
  }

  /**
   * Dispatch a tool_use block via ScaffoldToolRegistry.
   *
   * REFACTORED: No more switch(block.name). The registry does the lookup.
   * Unknown tools return a structured error that the LLM can recover from.
   */
  private async executeTool(
    block: { id: string; name: string; input: Record<string, unknown> },
    workspaceRoot: string,
    onProgress: ProgressCallback
  ): Promise<ToolExecutionResult> {
    const tool = ScaffoldToolRegistry.get(block.name);

    if (!tool) {
      return {
        toolUseId: block.id,
        success: false,
        output: "",
        error: `Unknown tool: ${block.name}. Available: ${ScaffoldToolRegistry.getNames().join(", ")}`,
      };
    }

    // Build the execution context — decouples tools from engine internals
    const context: ToolExecutionContext = {
      toolUseId: block.id,
      workspaceRoot,
      onProgress,
      requestApproval: (title, detail) => this.requestApproval(title, detail),
    };

    const input = block.input as Record<string, string>;

    try {
      return await tool.call(input, context);
    } catch (err) {
      return {
        toolUseId: block.id,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async requestApproval(title: string, detail: string): Promise<boolean> {
    const answer = await vscode.window.showInformationMessage(
      `NeuroCode Scaffold: ${title}`,
      { modal: true, detail },
      "Allow",
      "Deny"
    );
    return answer === "Allow";
  }

  dispose(): void {
    disposeExecutor();
  }
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildScaffoldPrompt(request: ScaffoldRequest): string {
  const { assignment, workspaceRoot } = request;
  const { metadata, sections, starterCode } = assignment;

  const sectionSummary = sections
    .map((s) => `- [${s.type}] ${s.title}`)
    .join("\n");

  const lines = [
    `Create a starter project for the following assignment in: ${workspaceRoot}`,
    "",
    `Title: ${metadata.title}`,
    `Language: ${metadata.language}`,
    `Tags: ${(metadata.tags ?? []).join(", ") || "none"}`,
    `Difficulty: ${metadata.difficulty}`,
    "",
    `Description: ${metadata.description}`,
    "",
    "Assignment sections:",
    sectionSummary,
  ];

  if (starterCode) {
    lines.push("", "Starter code (use as the initial content of the main source file):");
    lines.push("```");
    lines.push(starterCode);
    lines.push("```");
  }

  lines.push(
    "",
    "Scaffold the project now. Use tools step by step.",
    "End by calling open_in_editor on the main file the student should edit."
  );

  return lines.join("\n");
}
