/**
 * SessionContext — Aggregates activity tracking and struggle detection
 * into a unified session context for LLM consumption.
 *
 * This module assembles the contextual information described in the project spec:
 *   (1) Assignment content and structure
 *   (2) User neurodiversity type and cognitive support preferences
 *   (3) Interaction history and focus data from editing session
 */
import type { ActivityTracker } from "./ActivityTracker";
import type { StruggleDetector } from "./StruggleDetector";
import type { SessionContext as SessionContextType, Assignment, UserPreferences } from "@shared/types";
import { Logger } from "@shared/logger";

// Simple UUID alternative without external dependency
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class SessionContextManager {
  private activityTracker: ActivityTracker;
  private struggleDetector: StruggleDetector;
  private currentSession: SessionContextType;

  constructor(activityTracker: ActivityTracker, struggleDetector: StruggleDetector) {
    this.activityTracker = activityTracker;
    this.struggleDetector = struggleDetector;
    this.currentSession = this.createNewSession();
  }

  /**
   * Create a fresh session.
   */
  private createNewSession(): SessionContextType {
    return {
      sessionId: generateSessionId(),
      startedAt: Date.now(),
      assignmentId: undefined,
      activeFile: undefined,
      currentSection: undefined,
      timeOnTask: 0,
      activityEvents: [],
      struggleIndicators: [],
      editCount: 0,
      filesSeen: [],
    };
  }

  /**
   * Start a new session for an assignment.
   */
  startSession(assignmentId: string): void {
    this.activityTracker.reset();
    this.struggleDetector.reset();
    this.currentSession = this.createNewSession();
    this.currentSession.assignmentId = assignmentId;
    Logger.log(`Session started for assignment: ${assignmentId}`);
  }

  /**
   * Update the current session with latest tracking data.
   * Called before sending context to the LLM.
   */
  refreshContext(): SessionContextType {
    const newEvents = this.activityTracker.getAndClearEvents();
    const newIndicators = this.struggleDetector.getAndClearIndicators();

    this.currentSession.activityEvents.push(...newEvents);
    this.currentSession.struggleIndicators.push(...newIndicators);
    this.currentSession.timeOnTask = Date.now() - this.currentSession.startedAt;
    this.currentSession.editCount = this.activityTracker.getTotalEditCount();
    this.currentSession.filesSeen = this.activityTracker.getEditedFiles();

    return { ...this.currentSession };
  }

  /**
   * Get a compact summary of the session for LLM context.
   * We don't send all raw events — we summarize to save tokens.
   */
  getContextSummary(): Record<string, unknown> {
    const session = this.refreshContext();
    const recentEvents = session.activityEvents.slice(-20); // Last 20 events
    const activeIndicators = session.struggleIndicators.filter(
      (i) => Date.now() - i.timestamp < 300_000 // Last 5 minutes
    );

    return {
      sessionId: session.sessionId,
      assignmentId: session.assignmentId,
      timeOnTaskMinutes: Math.round(session.timeOnTask / 60_000),
      totalEdits: session.editCount,
      filesWorkedOn: session.filesSeen.length,
      currentSection: session.currentSection,
      activeFile: session.activeFile,
      recentActivitySummary: this.summarizeEvents(recentEvents),
      activeStruggles: activeIndicators.map((i) => ({
        type: i.type,
        severity: i.severity,
        details: i.context.details,
      })),
      isCurrentlyIdle: this.activityTracker.getCurrentIdleDuration() > 60_000,
    };
  }

  /**
   * Summarize activity events into a compact description.
   */
  private summarizeEvents(events: SessionContextType["activityEvents"]): string {
    if (events.length === 0) { return "No recent activity"; }

    const counts: Record<string, number> = {};
    for (const event of events) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    }

    return Object.entries(counts)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ");
  }

  /**
   * Update which section the student is currently viewing.
   */
  setCurrentSection(sectionId: string): void {
    this.currentSession.currentSection = sectionId;
    this.activityTracker.recordActivity("section_view", { sectionId });
  }

  /**
   * Update the active file.
   */
  setActiveFile(filePath: string): void {
    this.currentSession.activeFile = filePath;
  }

  /**
   * Get the raw session object.
   */
  getSession(): SessionContextType {
    return { ...this.currentSession };
  }

  /**
   * End the current session.
   */
  endSession(): SessionContextType {
    const finalSession = this.refreshContext();
    Logger.log(
      `Session ended: ${finalSession.sessionId}, ` +
      `duration: ${Math.round(finalSession.timeOnTask / 60_000)}min, ` +
      `edits: ${finalSession.editCount}, ` +
      `struggles: ${finalSession.struggleIndicators.length}`
    );
    return finalSession;
  }

  dispose(): void {
    // No resources to dispose — tracker and detector are owned by Controller
  }
}
