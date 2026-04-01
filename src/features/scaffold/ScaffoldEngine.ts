/**
 * ScaffoldEngine — Agentic loop for project scaffolding.
 *
 * Inspired by Cline's Task class agentic loop pattern:
 *   while (true) {
 *     const response = await api.createMessage(...)
 *     if (stop_reason === "end_turn") break
 *     if (stop_reason === "tool_use") {
 *       await executeTools(response)  // then loop again with tool_result
 *     }
 *   }
 *
 * Key differences from AdaptationEngine:
 *   - Multi-turn conversation (tool_use loop, not single-shot)
 *   - Tools have real side effects (file creation, command execution)
 *   - Every tool call requires user approval via VS Code confirmation dialog
 *   - Uses VS Code workspace API for file writes
 */
import * as vscode from "vscode";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { CommandExecutor } from "./CommandExecutor";
import { buildToolsForAssignment } from "./ScaffoldToolBuilder";
import type { ScaffoldRequest, ToolExecutionResult } from "@shared/types";
import { Logger } from "@shared/logger";

const MAX_ITERATIONS = 20; // Safety limit — prevents runaway loops

type ProgressCallback = (message: string, isDone: boolean) => void;

export class ScaffoldEngine implements vscode.Disposable {
  private anthropic: Anthropic | undefined;
  private executor: CommandExecutor;
  private inProgress = false;

  constructor() {
    this.executor = new CommandExecutor();
  }

  setApiKey(apiKey: string): void {
    this.anthropic = new Anthropic({ apiKey });
  }

  get isAvailable(): boolean {
    return !!this.anthropic;
  }

  /**
   * Run the scaffolding agentic loop.
   * Sends the assignment context + tools to Claude, then executes each
   * tool_use block (with user approval) until Claude signals end_turn.
   */
  async run(request: ScaffoldRequest, onProgress: ProgressCallback): Promise<void> {
    if (!this.anthropic) {
      throw new Error("No API key configured. Set neurocode.anthropicApiKey in settings.");
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

    const systemPrompt = [
      "You are NeuroCode Scaffold, a programming tutor assistant that creates project skeletons for students.",
      systemHint,
      "",
      "Think step by step. Use tools one at a time. Do not explain yourself — just call tools.",
      "When the project is ready, call open_in_editor on the main entry file, then stop.",
    ].join("\n");

    const userMessage = buildScaffoldPrompt(request);

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    onProgress("Starting scaffolding...", false);

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.anthropic!.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      });

      Logger.log(`[ScaffoldEngine] Iteration ${i + 1}, stop_reason: ${response.stop_reason}`);

      // Collect all tool_use blocks in this response
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
        onProgress("Scaffolding complete.", true);
        break;
      }

      // Add assistant turn to history
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool in sequence (Cline pattern: sequential tool execution)
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        const result = await this.executeTool(block, request.workspaceRoot, onProgress);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.success ? result.output : `ERROR: ${result.error}`,
        });

        if (!result.success) {
          // Let Claude know the tool failed and decide how to recover
          Logger.warn(`[ScaffoldEngine] Tool ${block.name} failed: ${result.error}`);
        }
      }

      // Add tool results as user turn to continue the loop
      messages.push({ role: "user", content: toolResults });
    }
  }

  /**
   * Dispatch a single tool_use block to the correct handler.
   * Every tool call shows a VS Code confirmation dialog first.
   */
  private async executeTool(
    block: Anthropic.ToolUseBlock,
    workspaceRoot: string,
    onProgress: ProgressCallback
  ): Promise<ToolExecutionResult> {
    const input = block.input as Record<string, string>;

    switch (block.name) {
      case "execute_command":
        return this.handleExecuteCommand(block.id, input, workspaceRoot, onProgress);

      case "create_file":
        return this.handleCreateFile(block.id, input, workspaceRoot, onProgress);

      case "open_in_editor":
        return this.handleOpenInEditor(block.id, input, workspaceRoot, onProgress);

      default:
        return {
          toolUseId: block.id,
          success: false,
          output: "",
          error: `Unknown tool: ${block.name}`,
        };
    }
  }

  // ─── Tool Handlers ──────────────────────────────────────────────────────────

  private async handleExecuteCommand(
    toolUseId: string,
    input: Record<string, string>,
    workspaceRoot: string,
    onProgress: ProgressCallback
  ): Promise<ToolExecutionResult> {
    const { command, cwd: relativeCwd, description } = input;
    const resolvedCwd = relativeCwd
      ? path.resolve(workspaceRoot, relativeCwd)
      : workspaceRoot;

    onProgress(`Requesting approval: ${description ?? command}`, false);

    // ── User approval gate ──────────────────────────────────────────────────
    const approved = await this.requestApproval(
      `Run command: \`${command}\``,
      `Directory: ${resolvedCwd}\n\n${description ?? ""}`
    );

    if (!approved) {
      return { toolUseId, success: false, output: "", error: "User rejected command." };
    }

    onProgress(`Running: ${command}`, false);

    try {
      const { output, exitCode } = await this.executor.execute(command, resolvedCwd);
      if (exitCode !== 0) {
        return { toolUseId, success: false, output, error: `Exit code ${exitCode}` };
      }
      return { toolUseId, success: true, output };
    } catch (err) {
      return {
        toolUseId,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleCreateFile(
    toolUseId: string,
    input: Record<string, string>,
    workspaceRoot: string,
    onProgress: ProgressCallback
  ): Promise<ToolExecutionResult> {
    const { path: relativePath, content, description } = input;
    const absolutePath = path.resolve(workspaceRoot, relativePath);

    onProgress(`Requesting approval: create ${relativePath}`, false);

    const approved = await this.requestApproval(
      `Create file: \`${relativePath}\``,
      description ?? ""
    );

    if (!approved) {
      return { toolUseId, success: false, output: "", error: "User rejected file creation." };
    }

    try {
      const uri = vscode.Uri.file(absolutePath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      onProgress(`Created: ${relativePath}`, false);
      return { toolUseId, success: true, output: `File created: ${relativePath}` };
    } catch (err) {
      return {
        toolUseId,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleOpenInEditor(
    toolUseId: string,
    input: Record<string, string>,
    workspaceRoot: string,
    onProgress: ProgressCallback
  ): Promise<ToolExecutionResult> {
    const { path: relativePath } = input;
    const absolutePath = path.resolve(workspaceRoot, relativePath);

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      onProgress(`Opened: ${relativePath}`, false);
      return { toolUseId, success: true, output: `Opened ${relativePath} in editor.` };
    } catch (err) {
      return {
        toolUseId,
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
    this.executor.dispose();
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
