/**
 * AssignmentManager — Handles assignment lifecycle.
 *
 * REFACTORED (M1): Now holds a PromptBuilder and forwards it to parseAssignmentFile
 * so Tier 1 (direct PDF parsing) uses template-driven prompts.
 */
import * as vscode from "vscode";
import * as path from "path";
import type { Assignment } from "@shared/types";
import type { LlmProvider } from "@services/llm/LlmProvider";
import type { PromptBuilder } from "@services/prompts";
import { Logger } from "@shared/logger";
import { parseAssignmentFile } from "./parser";

export class AssignmentManager implements vscode.Disposable {
  private currentAssignment: Assignment | null = null;
  private provider: LlmProvider | null = null;
  private promptBuilder: PromptBuilder | null = null;

  constructor(_context: vscode.ExtensionContext) {}

  setProvider(provider: LlmProvider | null): void {
    this.provider = provider;
  }

  /** REFACTORED: inject the builder used by parser.ts Tier 1 path. */
  setPromptBuilder(builder: PromptBuilder): void {
    this.promptBuilder = builder;
  }

  async importFromFile(filePath: string): Promise<Assignment> {
    try {
      const uri = vscode.Uri.file(filePath);
      const content = await vscode.workspace.fs.readFile(uri);
      const buffer = Buffer.from(content);

      Logger.log(`Importing PDF assignment: ${path.basename(filePath)}`);

      const assignment = await parseAssignmentFile(
        buffer,
        filePath,
        this.provider ?? undefined,
        this.promptBuilder ?? undefined,
      );
      this.currentAssignment = assignment;
      Logger.log(`Assignment loaded: ${assignment.metadata.title} (${assignment.sections.length} sections)`);
      return assignment;
    } catch (error) {
      Logger.error(`Failed to import assignment from ${filePath}:`, error);
      throw new Error(`Failed to import assignment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async promptImport(): Promise<Assignment | null> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: { "PDF Assignments": ["pdf"] },
      title: "Select PDF Assignment File",
    });

    if (!uris || uris.length === 0) { return null; }

    const filePath = uris[0].fsPath;

    if (!this.provider) {
      const proceed = await vscode.window.showWarningMessage(
        "PDF parsing works best with an LLM provider configured. " +
        "Without it, basic heuristic parsing will be used (less accurate). Continue?",
        "Continue", "Configure Provider", "Cancel",
      );
      if (proceed === "Configure Provider") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "neurocode.llmProvider");
        return null;
      }
      if (proceed !== "Continue") { return null; }
    }

    return this.importFromFile(filePath);
  }

  getCurrentAssignment(): Assignment | null { return this.currentAssignment; }

  dispose(): void {}
}
