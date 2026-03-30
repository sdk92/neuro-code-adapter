/**
 * StruggleDetector — Identifies when a student is struggling.
 *
 * Design pattern: Extends Cline's context tracking concept.
 * While Cline's FileContextTracker detects stale file contexts,
 * we detect *learning struggle indicators* using heuristic patterns:
 *
 *   1. Repeated edits: Same region edited many times in short window
 *   2. Long pauses: Extended inactivity suggesting confusion or frustration
 *   3. Rapid switching: Frequent file/tab changes suggesting disorientation
 *   4. Error loops: Repeated compilation or runtime errors
 *   5. Help seeking: Frequent use of help/hint features
 *
 * The detector runs periodically and produces StruggleIndicator events
 * that feed into the AdaptationEngine for real-time support.
 */
import type { ActivityTracker } from "./ActivityTracker";
import type { ActivityEvent, StruggleIndicator } from "@shared/types";
import { Logger } from "@shared/logger";

// ─── Configuration thresholds ────────────────────────────────────────────────

interface DetectionThresholds {
  /** Edits in same file within window to flag repeated_edits */
  repeatedEditsCount: number;
  repeatedEditsWindowMs: number;

  /** Idle duration to flag long_pause */
  longPauseMs: number;

  /** File switches within window to flag rapid_switching */
  rapidSwitchCount: number;
  rapidSwitchWindowMs: number;

  /** Minimum interval between emitting same type of indicator */
  cooldownMs: number;
}

const DEFAULT_THRESHOLDS: DetectionThresholds = {
  repeatedEditsCount: 15,
  repeatedEditsWindowMs: 60_000,    // 15 edits in same file within 1 min
  longPauseMs: 180_000,             // 3 minutes of inactivity
  rapidSwitchCount: 8,
  rapidSwitchWindowMs: 30_000,      // 8 file switches in 30 seconds
  cooldownMs: 120_000,              // Don't re-emit same indicator type within 2 min
};

export class StruggleDetector {
  private activityTracker: ActivityTracker;
  private thresholds: DetectionThresholds;
  private indicators: StruggleIndicator[] = [];
  private lastEmitted: Map<string, number> = new Map();
  private detectionInterval: ReturnType<typeof setInterval> | undefined;

  constructor(activityTracker: ActivityTracker, thresholds?: Partial<DetectionThresholds>) {
    this.activityTracker = activityTracker;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Start periodic struggle detection.
   */
  start(intervalMs: number = 10_000): void {
    this.detectionInterval = setInterval(() => {
      this.detectAll();
    }, intervalMs);
    Logger.debug("StruggleDetector started");
  }

  /**
   * Stop periodic detection.
   */
  stop(): void {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = undefined;
    }
  }

  /**
   * Run all detection heuristics.
   */
  private detectAll(): void {
    this.detectRepeatedEdits();
    this.detectLongPause();
    this.detectRapidSwitching();
  }

  /**
   * Detect repeated edits in the same file.
   * Pattern: Student editing the same region many times = possibly stuck on a problem.
   */
  private detectRepeatedEdits(): void {
    const events = this.getRecentEvents(this.thresholds.repeatedEditsWindowMs);
    const editsByFile = new Map<string, number>();

    for (const event of events) {
      if (event.type === "file_edit" && event.data.filePath) {
        const path = event.data.filePath as string;
        editsByFile.set(path, (editsByFile.get(path) ?? 0) + 1);
      }
    }

    for (const [filePath, count] of editsByFile) {
      if (count >= this.thresholds.repeatedEditsCount) {
        this.emitIndicator({
          timestamp: Date.now(),
          type: "repeated_edits",
          severity: count >= this.thresholds.repeatedEditsCount * 2 ? "high" : "medium",
          context: {
            filePath,
            details: `${count} edits in ${Math.round(this.thresholds.repeatedEditsWindowMs / 1000)}s`,
          },
        });
      }
    }
  }

  /**
   * Detect long pauses suggesting confusion or frustration.
   */
  private detectLongPause(): void {
    const idleDuration = this.activityTracker.getCurrentIdleDuration();

    if (idleDuration >= this.thresholds.longPauseMs) {
      const severity = idleDuration >= this.thresholds.longPauseMs * 2 ? "high" : "medium";
      this.emitIndicator({
        timestamp: Date.now(),
        type: "long_pause",
        severity,
        context: {
          details: `Inactive for ${Math.round(idleDuration / 60_000)} minutes`,
        },
      });
    }
  }

  /**
   * Detect rapid file switching suggesting disorientation.
   */
  private detectRapidSwitching(): void {
    const switchCount = this.activityTracker.getRecentFileSwitchCount(
      this.thresholds.rapidSwitchWindowMs
    );

    if (switchCount >= this.thresholds.rapidSwitchCount) {
      this.emitIndicator({
        timestamp: Date.now(),
        type: "rapid_switching",
        severity: switchCount >= this.thresholds.rapidSwitchCount * 1.5 ? "high" : "medium",
        context: {
          details: `${switchCount} file switches in ${Math.round(this.thresholds.rapidSwitchWindowMs / 1000)}s`,
        },
      });
    }
  }

  /**
   * Manually record a help-seeking indicator (called from outside).
   */
  recordHelpSeeking(sectionId?: string): void {
    this.emitIndicator({
      timestamp: Date.now(),
      type: "help_seeking",
      severity: "low",
      context: {
        sectionId,
        details: "Student requested help",
      },
    });
  }

  /**
   * Emit an indicator with cooldown to avoid flooding.
   */
  private emitIndicator(indicator: StruggleIndicator): void {
    const lastTime = this.lastEmitted.get(indicator.type) ?? 0;
    if (Date.now() - lastTime < this.thresholds.cooldownMs) {
      return; // Still in cooldown
    }

    this.indicators.push(indicator);
    this.lastEmitted.set(indicator.type, Date.now());
    Logger.debug(
      `Struggle detected: ${indicator.type} (${indicator.severity}) — ${indicator.context.details}`
    );
  }

  /**
   * Get and clear accumulated indicators.
   * Follows Cline's getAndClear pattern.
   */
  getAndClearIndicators(): StruggleIndicator[] {
    const indicators = [...this.indicators];
    this.indicators = [];
    return indicators;
  }

  /**
   * Get all indicators without clearing.
   */
  getIndicators(): StruggleIndicator[] {
    return [...this.indicators];
  }

  /**
   * Get recent activity events from the tracker (peek without clearing).
   * Uses ActivityTracker.peekEvents() for read-only access.
   */
  private getRecentEvents(windowMs: number): ActivityEvent[] {
    return this.activityTracker.peekEvents(windowMs);
  }

  /**
   * Reset detection state.
   */
  reset(): void {
    this.indicators = [];
    this.lastEmitted.clear();
  }

  dispose(): void {
    this.stop();
  }
}
