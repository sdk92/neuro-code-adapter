/**
 * SessionContext — Tracks basic session state for LLM consumption.
 *
 * Maintains session identity, assignment association, and timing data.
 * Consumed by AdaptationEngine to provide context when generating adaptations.
 */
import type { SessionContext as SessionContextType } from "@shared/types";
import { Logger } from "@shared/logger";

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class SessionContextManager {
  private currentSession: SessionContextType;

  constructor() {
    this.currentSession = this.createNewSession();
  }

  private createNewSession(): SessionContextType {
    return {
      sessionId: generateSessionId(),
      startedAt: Date.now(),
      assignmentId: undefined,
      activeFile: undefined,
      currentSection: undefined,
      timeOnTask: 0,
    };
  }

  startSession(assignmentId: string): void {
    this.currentSession = this.createNewSession();
    this.currentSession.assignmentId = assignmentId;
    Logger.log(`Session started for assignment: ${assignmentId}`);
  }

  refreshContext(): SessionContextType {
    this.currentSession.timeOnTask = Date.now() - this.currentSession.startedAt;
    return { ...this.currentSession };
  }

  setCurrentSection(sectionId: string): void {
    this.currentSession.currentSection = sectionId;
  }

  setActiveFile(filePath: string): void {
    this.currentSession.activeFile = filePath;
  }

  getSession(): SessionContextType {
    return { ...this.currentSession };
  }

  endSession(): SessionContextType {
    const finalSession = this.refreshContext();
    Logger.log(
      `Session ended: ${finalSession.sessionId}, ` +
      `duration: ${Math.round(finalSession.timeOnTask / 60_000)}min`
    );
    return finalSession;
  }

  dispose(): void {
    // No resources to dispose
  }
}
