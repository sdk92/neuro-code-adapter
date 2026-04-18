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
  ScaffoldProgress,
  UserPreferences,
} from "./types";

// ─── Extension → Webview Messages ────────────────────────────────────────────

export type ExtensionMessage =
  | { type: "state_update"; state: Partial<ExtensionState> }
  | { type: "assignment_loaded"; assignment: Assignment }
  | { type: "adaptation_result"; adaptation: AdaptationResponse }
  | { type: "adaptation_progress"; status: "started" | "streaming" | "complete" | "error"; message?: string }
  | { type: "preferences_updated"; preferences: UserPreferences }
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
  mcpServer: McpServerInfo | null;
  version: string;
}

// ─── Webview → Extension Messages ────────────────────────────────────────────
// REFACTORED (M2): WebviewMessage is now inferred from the Zod schema in
// @shared/schemas/webview-messages. Keeping it as a re-export preserves the
// existing import path `@shared/messages` used by ~30 call sites.

export type { WebviewMessage } from "./schemas";
