/**
 * ActivityTracker — Monitors student editing behavior in real-time.
 *
 * Design pattern: Borrowed from Cline's FileContextTracker.
 * Cline tracks file reads/edits/mentions with timestamps and uses chokidar watchers.
 * We adapt this pattern to track learning-relevant events:
 *   - File opens and edits (frequency, duration)
 *   - Cursor movement patterns (rapid switching = potential confusion)
 *   - Pause/resume cycles (long pauses = potential struggle)
 *   - Section viewing in assignment webview
 *
 * Key Cline patterns adopted:
 *   1. Event-driven tracking with VS Code API listeners
 *   2. Timestamped metadata entries with state transitions (active/stale)
 *   3. getAndClear pattern for consuming accumulated events
 *   4. Disposable watcher lifecycle management
 */
import * as vscode from "vscode";
import type { ActivityEvent } from "@shared/types";
import { Logger } from "@shared/logger";

const IDLE_THRESHOLD_MS = 60_000; // 1 minute of no activity = pause

export class ActivityTracker implements vscode.Disposable {
  private events: ActivityEvent[] = [];
  private disposables: vscode.Disposable[] = [];

  private lastActivityTimestamp: number = Date.now();
  private isPaused: boolean = false;
  private editCounts: Map<string, number> = new Map();
  private fileSwitchTimestamps: number[] = [];
  private idleCheckInterval: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.setupListeners();
    this.startIdleDetection();
  }

  /**
   * Set up VS Code event listeners for tracking student activity.
   * Mirrors Cline's approach of using workspace.onDidChangeTextDocument
   * and window.onDidChangeActiveTextEditor.
   */
  private setupListeners(): void {
    // Track document edits
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length === 0) { return; }
        const filePath = event.document.uri.fsPath;
        this.recordActivity("file_edit", {
          filePath,
          changeCount: event.contentChanges.length,
          lineCount: event.document.lineCount,
        });
        this.editCounts.set(filePath, (this.editCounts.get(filePath) ?? 0) + 1);
      })
    );

    // Track file switching
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) { return; }
        const filePath = editor.document.uri.fsPath;
        this.fileSwitchTimestamps.push(Date.now());
        this.recordActivity("file_open", { filePath });
      })
    );

    // Track cursor movements (debounced — only meaningful moves)
    let cursorDebounce: ReturnType<typeof setTimeout> | undefined;
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (cursorDebounce) { clearTimeout(cursorDebounce); }
        cursorDebounce = setTimeout(() => {
          const pos = event.selections[0]?.active;
          if (pos) {
            this.recordActivity("cursor_move", {
              filePath: event.textEditor.document.uri.fsPath,
              line: pos.line,
              character: pos.character,
            });
          }
        }, 500); // Only record after 500ms of no further cursor movement
      })
    );

    // Track document open
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.recordActivity("file_open", { filePath: doc.uri.fsPath });
      })
    );
  }

  /**
   * Idle detection — detects pauses in student activity.
   * If no activity for IDLE_THRESHOLD_MS, emit a "pause" event.
   * When activity resumes, emit a "resume" event.
   */
  private startIdleDetection(): void {
    this.idleCheckInterval = setInterval(() => {
      const elapsed = Date.now() - this.lastActivityTimestamp;
      if (elapsed > IDLE_THRESHOLD_MS && !this.isPaused) {
        this.isPaused = true;
        this.events.push({
          timestamp: this.lastActivityTimestamp + IDLE_THRESHOLD_MS,
          type: "pause",
          data: { idleDurationMs: elapsed },
        });
        Logger.debug(`Student idle for ${Math.round(elapsed / 1000)}s — pause detected`);
      }
    }, 10_000); // Check every 10 seconds
  }

  /**
   * Record an activity event with automatic pause/resume detection.
   */
  recordActivity(type: ActivityEvent["type"], data: Record<string, unknown> = {}): void {
    const now = Date.now();

    // Detect resume from pause
    if (this.isPaused) {
      this.isPaused = false;
      this.events.push({
        timestamp: now,
        type: "resume",
        data: { pauseDurationMs: now - this.lastActivityTimestamp },
      });
    }

    this.lastActivityTimestamp = now;
    this.events.push({ timestamp: now, type, data });
  }

  /**
   * Get and clear accumulated events.
   * Follows Cline's getAndClearRecentlyModifiedFiles pattern.
   */
  getAndClearEvents(): ActivityEvent[] {
    const events = [...this.events];
    this.events = [];
    return events;
  }

  /**
   * Peek at recent events without clearing them.
   * Used by StruggleDetector for read-only analysis.
   *
   * This solves a design gap: getAndClear is for the SessionContextManager
   * (which consumes events), while peekEvents is for the StruggleDetector
   * (which just analyses them). Both can coexist because detection runs
   * more frequently than context refresh.
   *
   * @param windowMs Only return events within this time window
   */
  peekEvents(windowMs?: number): ActivityEvent[] {
    if (windowMs === undefined) {
      return [...this.events];
    }
    const cutoff = Date.now() - windowMs;
    return this.events.filter((e) => e.timestamp > cutoff);
  }

  /**
   * Get edit count for a specific file.
   */
  getEditCount(filePath: string): number {
    return this.editCounts.get(filePath) ?? 0;
  }

  /**
   * Get total edit count across all files.
   */
  getTotalEditCount(): number {
    let total = 0;
    for (const count of this.editCounts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get all files that have been edited.
   */
  getEditedFiles(): string[] {
    return Array.from(this.editCounts.keys());
  }

  /**
   * Count rapid file switches within a time window.
   * Used by StruggleDetector to identify confusion.
   */
  getRecentFileSwitchCount(windowMs: number = 30_000): number {
    const cutoff = Date.now() - windowMs;
    return this.fileSwitchTimestamps.filter((ts) => ts > cutoff).length;
  }

  /**
   * Get current idle duration in milliseconds.
   */
  getCurrentIdleDuration(): number {
    return Date.now() - this.lastActivityTimestamp;
  }

  /**
   * Reset all tracking state. Called when a new assignment is opened.
   */
  reset(): void {
    this.events = [];
    this.editCounts.clear();
    this.fileSwitchTimestamps = [];
    this.lastActivityTimestamp = Date.now();
    this.isPaused = false;
  }

  dispose(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
