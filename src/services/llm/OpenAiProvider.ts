/**
 * OpenAiProvider — LlmProvider for OpenAI-compatible APIs.
 *
 * Uses raw fetch against the /v1/chat/completions endpoint.
 * No SDK dependency needed — works with:
 *   - OpenAI
 *   - Ollama (via http://localhost:11434/v1)
 *   - LM Studio (via http://localhost:1234/v1)
 *   - Azure OpenAI (with appropriate baseUrl)
 *   - Any other OpenAI-compatible endpoint
 *
 * Limitations vs AnthropicProvider:
 *   - Does NOT support raw document/PDF input (supportsDocumentInput = false).
 *     Callers must pre-extract text before sending to this provider.
 *   - Tool call format differs from Anthropic; this class normalises both directions.
 */
import type {
  LlmProvider,
  LlmCompletionParams,
  LlmToolCompletionParams,
  LlmTextResponse,
  LlmToolResponse,
  LlmResponseBlock,
  LlmMessage,
  LlmContentPart,
  LlmToolDef,
} from "./LlmProvider";
import { Logger } from "@shared/logger";

// ─── OpenAI API types (minimal subset) ──────────────────────────────────────

interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}

interface OaiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OaiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OaiChoice {
  message: OaiMessage;
  finish_reason: string;
}

interface OaiChatResponse {
  choices: OaiChoice[];
  error?: { message: string };
}

// ─── Provider ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAiProvider implements LlmProvider {
  readonly name = "OpenAI";
  readonly supportsDocumentInput = false;
  readonly model: string;

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    Logger.log(`OpenAiProvider initialised (model: ${model}, baseUrl: ${this.baseUrl})`);
  }

  // ─── complete() ──────────────────────────────────────────────────────────

  async complete(params: LlmCompletionParams): Promise<LlmTextResponse> {
    const messages = this.toOaiMessages(params.system, params.messages);

    const body = {
      model: this.model,
      messages,
      max_tokens: params.maxTokens,
    };

    const data = await this.postChatCompletions(body);
    const choice = data.choices?.[0];

    return {
      text: choice?.message?.content ?? "",
      stopReason: this.normaliseFinishReason(choice?.finish_reason),
    };
  }

  // ─── completeWithTools() ─────────────────────────────────────────────────

  async completeWithTools(params: LlmToolCompletionParams): Promise<LlmToolResponse> {
    const messages = this.toOaiMessages(params.system, params.messages);
    const tools = this.toOaiTools(params.tools);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: params.maxTokens,
    };
    if (tools.length > 0) {
      body.tools = tools;
    }
    if (params.toolChoice) {
      body.tool_choice = { type: "function", function: { name: params.toolChoice.name } };
    }

    const data = await this.postChatCompletions(body);
    const choice = data.choices?.[0];

    return {
      content: this.parseResponseBlocks(choice?.message),
      stopReason: this.normaliseFinishReason(choice?.finish_reason),
    };
  }

  // ─── HTTP transport ──────────────────────────────────────────────────────

  private async postChatCompletions(body: Record<string, unknown>): Promise<OaiChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `OpenAI API error (${response.status}): ${errorText}`
      );
    }

    const data = await response.json() as OaiChatResponse;
    if (data.error) {
      throw new Error(`OpenAI API error: ${data.error.message}`);
    }

    return data;
  }

  // ─── Message conversion ──────────────────────────────────────────────────

  /**
   * Convert normalised messages to OpenAI format.
   *
   * Key differences from Anthropic:
   *   - System prompt is a message with role "system" (not a separate param)
   *   - No "document" content blocks (PDF not supported)
   *   - Tool results use role "tool" with tool_call_id
   *   - Tool calls are in message.tool_calls array (not content blocks)
   */
  private toOaiMessages(system: string, messages: LlmMessage[]): OaiMessage[] {
    const result: OaiMessage[] = [];

    // System prompt as first message
    if (system) {
      result.push({ role: "system", content: system });
    }

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Array of content parts — need to split into text and tool parts
      const textParts: string[] = [];
      const toolCalls: OaiToolCall[] = [];
      const toolResults: OaiMessage[] = [];

      for (const part of msg.content) {
        switch (part.type) {
          case "text":
            textParts.push(part.text);
            break;

          case "document":
            // OpenAI doesn't support documents — include a note
            textParts.push("[Document content not supported by this provider — text was pre-extracted]");
            break;

          case "tool_use":
            toolCalls.push({
              id: part.id,
              type: "function",
              function: {
                name: part.name,
                arguments: JSON.stringify(part.input),
              },
            });
            break;

          case "tool_result":
            toolResults.push({
              role: "tool",
              content: part.content,
              tool_call_id: part.toolUseId,
            });
            break;
        }
      }

      // Emit assistant message with optional tool_calls
      if (msg.role === "assistant") {
        const assistantMsg: OaiMessage = {
          role: "assistant",
          content: textParts.length > 0 ? textParts.join("\n") : null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        result.push(assistantMsg);
      } else {
        // User message — just join text
        if (textParts.length > 0) {
          result.push({ role: "user", content: textParts.join("\n") });
        }
      }

      // Tool results as separate "tool" role messages
      result.push(...toolResults);
    }

    return result;
  }

  private toOaiTools(tools: LlmToolDef[]): OaiTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  // ─── Response parsing ────────────────────────────────────────────────────

  /**
   * Parse an OpenAI response message into normalised content blocks.
   *
   * OpenAI puts tool calls in message.tool_calls (not content blocks like Anthropic),
   * so we normalise them into the same LlmResponseBlock format.
   */
  private parseResponseBlocks(message: OaiMessage | undefined): LlmResponseBlock[] {
    if (!message) { return []; }

    const blocks: LlmResponseBlock[] = [];

    // Text content
    if (message.content) {
      blocks.push({ type: "text", text: message.content });
    }

    // Tool calls → normalised tool_use blocks
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          Logger.warn(`Failed to parse tool call arguments for ${tc.function.name}`);
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    return blocks;
  }

  private normaliseFinishReason(reason: string | undefined): string {
    if (!reason) { return "end_turn"; }
    // OpenAI uses: "stop", "length", "tool_calls", "content_filter"
    switch (reason) {
      case "stop": return "end_turn";
      case "length": return "max_tokens";
      case "tool_calls": return "tool_use";
      default: return reason;
    }
  }

  dispose(): void {
    Logger.log("OpenAiProvider disposed");
  }
}
