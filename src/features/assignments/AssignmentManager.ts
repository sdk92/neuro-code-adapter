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

interface ProgressRecord {
  assignmentId: string;
  startedAt: number;
  lastAccessedAt: number;
  completedSections: string[];
  totalTimeMs: number;
  codeSnapshots: Array<{ timestamp: number; filePath: string; content: string }>;
}

export class AssignmentManager implements vscode.Disposable {
  private context: vscode.ExtensionContext;
  private currentAssignment: Assignment | null = null;
  private progress: Map<string, ProgressRecord> = new Map();
  private provider: LlmProvider | null = null;
  private promptBuilder: PromptBuilder | null = null;

  private static readonly PROGRESS_KEY = "neurocode.assignmentProgress";

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    const saved = context.globalState.get<Record<string, ProgressRecord>>(AssignmentManager.PROGRESS_KEY);
    if (saved) {
      for (const [id, record] of Object.entries(saved)) {
        this.progress.set(id, record);
      }
    }
  }

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
      this.initializeProgress(assignment.metadata.id);
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

  markSectionComplete(sectionId: string): void {
    if (!this.currentAssignment) { return; }
    const record = this.progress.get(this.currentAssignment.metadata.id);
    if (record && !record.completedSections.includes(sectionId)) {
      record.completedSections.push(sectionId);
      this.saveProgress();
    }
  }

  getCurrentAssignment(): Assignment | null { return this.currentAssignment; }

  getProgress(): ProgressRecord | null {
    if (!this.currentAssignment) { return null; }
    return this.progress.get(this.currentAssignment.metadata.id) ?? null;
  }

  async exportProgress(): Promise<string> {
    if (!this.currentAssignment) { throw new Error("No assignment loaded"); }
    const record = this.progress.get(this.currentAssignment.metadata.id);
    const report = {
      assignment: this.currentAssignment.metadata,
      progress: record,
      completionRate: record
        ? record.completedSections.length / this.currentAssignment.sections.length
        : 0,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(report, null, 2);
  }

  private initializeProgress(assignmentId: string): void {
    if (!this.progress.has(assignmentId)) {
      this.progress.set(assignmentId, {
        assignmentId,
        startedAt: Date.now(),
        lastAccessedAt: Date.now(),
        completedSections: [],
        totalTimeMs: 0,
        codeSnapshots: [],
      });
    } else {
      this.progress.get(assignmentId)!.lastAccessedAt = Date.now();
    }
    this.saveProgress();
  }

  private saveProgress(): void {
    const obj: Record<string, ProgressRecord> = {};
    for (const [id, record] of this.progress) { obj[id] = record; }
    this.context.globalState.update(AssignmentManager.PROGRESS_KEY, obj);
  }

  dispose(): void { this.saveProgress(); }
}
