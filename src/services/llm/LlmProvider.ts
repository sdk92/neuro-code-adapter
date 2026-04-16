/**
 * LlmProvider — Unified interface for LLM backends.
 *
 * Abstracts the differences between Anthropic, OpenAI, and OpenAI-compatible
 * endpoints (Ollama, LM Studio, Azure, etc.) behind a single interface.
 *
 * Three operations map to the three LLM call sites in the codebase:
 *   1. complete()          — parser.ts (PDF structuring), AdaptationEngine (adaptation)
 *   2. completeWithTools() — ScaffoldEngine (agentic tool-use loop)
 *
 * Design: follows the same "interface + registry" philosophy as ProfileRegistry
 * and ScaffoldToolRegistry. Adding a new provider = implement this interface.
 *
 * Inspired by Cline's multi-provider architecture (ApiHandler / ApiProvider).
 */

// ─── Normalised message types ───────────────────────────────────────────────

export type LlmRole = "user" | "assistant";

/**
 * Content parts within a message.
 *
 * "document" is for sending raw files (e.g. PDF) to the LLM.
 * Not all providers support this — check provider.supportsDocumentInput.
 *
 * "tool_use" and "tool_result" are for agentic tool-call loops.
 */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "document"; mediaType: string; data: string } // base64-encoded
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string };

/**
 * A single message in the conversation.
 * content can be a plain string (shorthand for a single text block)
 * or an array of content parts (for multi-modal / tool-use messages).
 */
export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentPart[];
}

// ─── Tool definitions ───────────────────────────────────────────────────────

export interface LlmToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── Response types ─────────────────────────────────────────────────────────

/**
 * Simple text completion result.
 */
export interface LlmTextResponse {
  text: string;
  stopReason: "end_turn" | "max_tokens" | "tool_use" | string;
}

/**
 * A content block in a tool-use response.
 */
export type LlmResponseBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/**
 * Response from completeWithTools() — may contain text and/or tool_use blocks.
 */
export interface LlmToolResponse {
  content: LlmResponseBlock[];
  stopReason: "end_turn" | "max_tokens" | "tool_use" | string;
}

// ─── Completion parameters ──────────────────────────────────────────────────

export interface LlmCompletionParams {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
}

export interface LlmToolCompletionParams extends LlmCompletionParams {
  tools: LlmToolDef[];
}

// ─── Provider interface ─────────────────────────────────────────────────────

export interface LlmProvider {
  /** Human-readable provider name (e.g. "Anthropic", "OpenAI") */
  readonly name: string;

  /** The model identifier currently configured (e.g. "claude-sonnet-4-20250514") */
  readonly model: string;

  /**
   * Whether the provider supports sending raw documents (PDF, images)
   * as content blocks. If false, callers must pre-extract text.
   */
  readonly supportsDocumentInput: boolean;

  /**
   * Simple text completion.
   * Used by: parser (PDF structuring), AdaptationEngine (adaptation).
   */
  complete(params: LlmCompletionParams): Promise<LlmTextResponse>;

  /**
   * Completion with tool definitions — returns content blocks that
   * may include tool_use requests.
   * Used by: ScaffoldEngine (agentic loop).
   */
  completeWithTools(params: LlmToolCompletionParams): Promise<LlmToolResponse>;

  /** Release any held resources. */
  dispose(): void;
}

// ─── Provider configuration ─────────────────────────────────────────────────

export type LlmProviderType = "anthropic" | "openai";

export interface LlmProviderConfig {
  provider: LlmProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string; // For OpenAI-compatible endpoints (Ollama, LM Studio, Azure, etc.)
}
