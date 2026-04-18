/**
 * Shared type definitions for NeuroCode Adapter.
 *
 * REFACTORED (M2): Domain types are now inferred from Zod schemas in
 * @shared/schemas. This file is kept as a backward-compatible facade
 * so the ~30 existing `import { Assignment } from "@shared/types"`
 * sites continue to work without modification.
 *
 * Types that cannot be schema-inferred (because they contain methods or
 * callbacks — e.g. NeurocodeToolDef has a `call()` method) remain as
 * hand-written interfaces in this file.
 *
 * For new code, prefer importing from @shared/schemas directly:
 *   import { AssignmentSchema, type Assignment } from "@shared/schemas";
 */

// ─── Re-exports from schema layer ─────────────────────────────────────────────

export type {
  // primitives
  NeurodiversityType,
  Difficulty,
  ColorScheme,
  TaskGranularity,
  SectionType,
  McpTransport,
} from "./schemas";

export type {
  // preferences
  UserPreferences,
  VisualPreferences,
  StructuralPreferences,
  CognitivePreferences,
  NeurodiversityProfile,
  PartialUserPreferences,
} from "./schemas";

export type {
  // assignment
  Assignment,
  AssignmentMetadata,
  AssignmentSection,
  AssignmentTestCase,
} from "./schemas";

export type {
  // adaptation
  AdaptationRequest,
  AdaptationResponse,
  AdaptedSection,
  VisualModification,
  SuggestedAction,
} from "./schemas";

// WebviewMessage is used in messages.ts too — we keep a single source.
export type { WebviewMessage } from "./schemas";

// ─── Scaffold types (NOT schema-inferred — contain methods) ──────────────────

import type { Assignment } from "./schemas";

export interface ScaffoldRequest {
  assignment: Assignment;
  workspaceRoot: string;
}

export interface ToolExecutionResult {
  toolUseId: string;
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolExecutionContext {
  toolUseId: string;
  workspaceRoot: string;
  onProgress: (message: string, isDone: boolean) => void;
  requestApproval: (title: string, detail: string) => Promise<boolean>;
}

/**
 * NeurocodeToolDef — self-contained tool definition.
 * Intentionally NOT schema-inferred: it has a `call()` method that Zod can't
 * express in a meaningful runtime sense.
 */
export interface NeurocodeToolDef {
  readonly name: string;
  description(hints?: string[]): string;
  readonly inputSchema: Record<string, unknown>;
  call(
    input: Record<string, string>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
  requiresApproval: boolean;
  isReadOnly: boolean;
  promptFragment?: string;
}

export interface ScaffoldProgress {
  message: string;
  isDone: boolean;
}

// ─── MCP types (external SDK shape, kept as interfaces) ──────────────────────

export type McpConnectionStatus = "connected" | "connecting" | "disconnected";

export interface McpServerInfo {
  name: string;
  status: McpConnectionStatus;
  error?: string;
  tools?: McpToolInfo[];
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: object;
}

export interface McpToolCallResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}
