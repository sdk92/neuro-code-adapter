/**
 * AssignmentManager — Handles assignment lifecycle.
 *
 * Responsibilities:
 *   - Import assignments from multiple formats (JSON, PDF, Markdown)
 *   - Parse and validate assignment structure
 *   - Track progress per assignment
 *   - Export progress reports
 *
 * PDF support: Uses a two-stage pipeline (parser.ts):
 *   Stage 1: pdf-parse extracts raw text from PDF
 *   Stage 2: LLM structures text into Assignment JSON (with heuristic fallback)
 */
import * as vscode from "vscode";
import * as path from "path";
import type { Assignment, AssignmentMetadata, AssignmentSection } from "@shared/types";
import { Logger } from "@shared/logger";
import { parseAssignmentFile, detectFormat } from "./parser";

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

  private apiKey: string = "";

  private static readonly PROGRESS_KEY = "neurocode.assignmentProgress";

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    // Restore saved progress
    const saved = context.globalState.get<Record<string, ProgressRecord>>(AssignmentManager.PROGRESS_KEY);
    if (saved) {
      for (const [id, record] of Object.entries(saved)) {
        this.progress.set(id, record);
      }
    }
  }

  /**
   * Set API key for LLM-based PDF structuring.
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Import an assignment from a file (JSON, PDF, or Markdown).
   * Automatically detects format from file extension.
   */
  async importFromFile(filePath: string): Promise<Assignment> {
    try {
      const format = detectFormat(filePath);
      const uri = vscode.Uri.file(filePath);
      const content = await vscode.workspace.fs.readFile(uri);
      const buffer = Buffer.from(content);

      Logger.log(`Importing assignment: ${path.basename(filePath)} (format: ${format})`);

      // For JSON, we can still use the legacy parser for backward compatibility
      if (format === "json") {
        const text = buffer.toString("utf-8");
        return this.parseAssignment(text, filePath);
      }

      // For PDF and Markdown, use the new multi-format parser
      const assignment = await parseAssignmentFile(buffer, filePath, this.apiKey);
      this.currentAssignment = assignment;
      this.initializeProgress(assignment.metadata.id);
      Logger.log(`Assignment loaded: ${assignment.metadata.title} (${assignment.sections.length} sections)`);
      return assignment;

    } catch (error) {
      Logger.error(`Failed to import assignment from ${filePath}:`, error);
      throw new Error(`Failed to import assignment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Import assignment from raw JSON string.
   */
  importFromString(jsonContent: string): Assignment {
    return this.parseAssignment(jsonContent);
  }

  /**
   * Parse and validate assignment JSON.
   */
  private parseAssignment(jsonContent: string, sourcePath?: string): Assignment {
    let raw: unknown;
    try {
      raw = JSON.parse(jsonContent);
    } catch {
      throw new Error("Invalid JSON format");
    }

    if (!raw || typeof raw !== "object") {
      throw new Error("Assignment must be a JSON object");
    }

    const obj = raw as Record<string, unknown>;

    // Validate metadata
    const metadata = this.parseMetadata(obj.metadata, sourcePath);

    // Validate sections
    if (!Array.isArray(obj.sections) || obj.sections.length === 0) {
      throw new Error("Assignment must contain at least one section");
    }
    const sections = obj.sections.map((s: unknown, i: number) => this.parseSection(s, i));

    const assignment: Assignment = {
      metadata,
      sections,
      starterCode: typeof obj.starterCode === "string" ? obj.starterCode : undefined,
      testCases: Array.isArray(obj.testCases)
        ? obj.testCases.map((tc: any) => ({
            id: String(tc.id ?? `test_${Math.random().toString(36).slice(2, 8)}`),
            description: String(tc.description ?? ""),
            input: String(tc.input ?? ""),
            expectedOutput: String(tc.expectedOutput ?? ""),
            isHidden: Boolean(tc.isHidden),
          }))
        : undefined,
      adaptationHints: typeof obj.adaptationHints === "object" ? obj.adaptationHints as any : undefined,
    };

    this.currentAssignment = assignment;
    this.initializeProgress(assignment.metadata.id);
    Logger.log(`Assignment loaded: ${metadata.title} (${sections.length} sections)`);

    return assignment;
  }

  /**
   * Parse assignment metadata with defaults.
   */
  private parseMetadata(raw: unknown, sourcePath?: string): AssignmentMetadata {
    const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const now = new Date().toISOString();

    return {
      id: String(obj.id ?? `assignment_${Date.now()}`),
      title: String(obj.title ?? path.basename(sourcePath ?? "Untitled Assignment", ".json")),
      description: String(obj.description ?? ""),
      author: String(obj.author ?? "Unknown"),
      createdAt: String(obj.createdAt ?? now),
      updatedAt: String(obj.updatedAt ?? now),
      difficulty: (["beginner", "intermediate", "advanced"].includes(String(obj.difficulty))
        ? String(obj.difficulty)
        : "intermediate") as AssignmentMetadata["difficulty"],
      estimatedMinutes: typeof obj.estimatedMinutes === "number" ? obj.estimatedMinutes : 60,
      language: String(obj.language ?? "C#"),
      tags: Array.isArray(obj.tags) ? obj.tags.map(String) : [],
    };
  }

  /**
   * Parse a single assignment section.
   */
  private parseSection(raw: unknown, index: number): AssignmentSection {
    if (!raw || typeof raw !== "object") {
      throw new Error(`Section ${index} is not a valid object`);
    }
    const obj = raw as Record<string, unknown>;
    const validTypes = ["instruction", "task", "hint", "example", "reference"];

    return {
      id: String(obj.id ?? `section_${index}`),
      title: String(obj.title ?? `Section ${index + 1}`),
      content: String(obj.content ?? ""),
      type: (validTypes.includes(String(obj.type)) ? String(obj.type) : "instruction") as AssignmentSection["type"],
      order: typeof obj.order === "number" ? obj.order : index,
      children: Array.isArray(obj.children)
        ? obj.children.map((c: unknown, i: number) => this.parseSection(c, i))
        : undefined,
    };
  }

  /**
   * Initialize progress tracking for an assignment.
   */
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

  /**
   * Mark a section as completed.
   */
  markSectionComplete(sectionId: string): void {
    if (!this.currentAssignment) { return; }
    const record = this.progress.get(this.currentAssignment.metadata.id);
    if (record && !record.completedSections.includes(sectionId)) {
      record.completedSections.push(sectionId);
      this.saveProgress();
    }
  }

  /**
   * Get current assignment.
   */
  getCurrentAssignment(): Assignment | null {
    return this.currentAssignment;
  }

  /**
   * Get progress for current assignment.
   */
  getProgress(): ProgressRecord | null {
    if (!this.currentAssignment) { return null; }
    return this.progress.get(this.currentAssignment.metadata.id) ?? null;
  }

  /**
   * Export progress report as JSON.
   */
  async exportProgress(): Promise<string> {
    if (!this.currentAssignment) {
      throw new Error("No assignment loaded");
    }

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

  /**
   * Prompt user to select and open an assignment file.
   * Supports JSON, PDF, and Markdown formats.
   */
  async promptImport(): Promise<Assignment | null> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: {
        "All Assignment Formats": ["json", "pdf", "md", "txt", "markdown"],
        "JSON Assignments": ["json"],
        "PDF Assignments": ["pdf"],
        "Markdown Assignments": ["md", "txt", "markdown"],
      },
      title: "Select Assignment File (JSON, PDF, or Markdown)",
    });

    if (!uris || uris.length === 0) { return null; }

    const filePath = uris[0].fsPath;
    const format = detectFormat(filePath);

    // Warn user about PDF parsing if no API key
    if (format === "pdf" && !this.apiKey) {
      const proceed = await vscode.window.showWarningMessage(
        "PDF parsing works best with an Anthropic API key configured. " +
        "Without it, basic heuristic parsing will be used (less accurate). Continue?",
        "Continue", "Configure API Key", "Cancel"
      );

      if (proceed === "Configure API Key") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "neurocode.anthropicApiKey");
        return null;
      }
      if (proceed !== "Continue") { return null; }
    }

    return this.importFromFile(filePath);
  }

  private saveProgress(): void {
    const obj: Record<string, ProgressRecord> = {};
    for (const [id, record] of this.progress) {
      obj[id] = record;
    }
    this.context.globalState.update(AssignmentManager.PROGRESS_KEY, obj);
  }

  dispose(): void {
    this.saveProgress();
  }
}
