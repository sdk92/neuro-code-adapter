/**
 * Message protocol between VS Code extension and Webview UI.
 * 
 * Design pattern: Borrowed from Cline's ExtensionMessage.ts / WebviewMessage.ts.
 * Cline uses typed discriminated unions for type-safe bidirectional messaging.
 * We adopt the same pattern but define messages specific to our adaptive learning domain.
 */
import type {
  AdaptationResponse,
  Assignment,
  McpServerInfo,
  NeurodiversityType,
  ScaffoldProgress,
  SessionContext,
  UserPreferences,
} from "./types";

// ─── Extension → Webview Messages ────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "state_update"; state: Partial<ExtensionState> }
  | { type: "assignment_loaded"; assignment: Assignment }
  | { type: "adaptation_result"; adaptation: AdaptationResponse }
  | { type: "adaptation_progress"; status: "started" | "streaming" | "complete" | "error"; message?: string }
  | { type: "preferences_updated"; preferences: UserPreferences }
  | { type: "session_update"; session: SessionContext }
  | { type: "mcp_status"; server: McpServerInfo }
  | { type: "error"; code: string; message: string }
  | { type: "info"; message: string }
  | { type: "scaffold_progress"; progress: ScaffoldProgress }
  | { type: "scaffold_approval_request"; toolUseId: string; command: string; cwd?: string };

/**
 * Full extension state — sent to webview on initialization and on changes.
 * Inspired by Cline's ExtensionState interface.
 */
export interface ExtensionState {
  isInitialized: boolean;
  currentAssignment: Assignment | null;
  currentAdaptation: AdaptationResponse | null;
  userPreferences: UserPreferences;
  sessionContext: SessionContext | null;
  mcpServer: McpServerInfo | null;
  version: string;
}

// ─── Webview → Extension Messages ────────────────────────────────────────────

export type WebviewMessage =
  | { type: "ready" }
  | { type: "request_state" }
  | { type: "open_assignment"; filePath: string }
  | { type: "open_preferences" }
  | { type: "request_help"; question: string; sectionId?: string }
  | { type: "update_preferences"; preferences: Partial<UserPreferences> }
  | { type: "set_profile"; profile: NeurodiversityType }
  | { type: "section_viewed"; sectionId: string }
  | { type: "export_progress" }
  | { type: "connect_mcp"; url: string; transport?: "stdio" | "streamableHttp" }
  | { type: "disconnect_mcp" }
  | { type: "request_scaffold" }
  | { type: "scaffold_approval_response"; toolUseId: string; approved: boolean };
