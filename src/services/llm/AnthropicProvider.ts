/**
 * AnthropicProvider — LlmProvider implementation for the Anthropic API.
 *
 * Wraps the @anthropic-ai/sdk to conform to the normalised LlmProvider interface.
 *
 * Key Anthropic-specific behaviours preserved:
 *   - Native PDF/document input via base64 "document" content blocks
 *   - Assistant-side prefill (used by parser for JSON forcing)
 *   - Streaming via .stream().finalMessage() for adaptation
 *   - Tool use via native tool blocks
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmProvider,
  LlmCompletionParams,
  LlmToolCompletionParams,
  LlmTextResponse,
  LlmToolResponse,
  LlmResponseBlock,
  LlmMessage,
  LlmContentPart,
} from "./LlmProvider";
import { Logger } from "@shared/logger";

export class AnthropicProvider implements LlmProvider {
  readonly name = "Anthropic";
  readonly supportsDocumentInput = true;
  readonly model: string;

  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    Logger.log(`AnthropicProvider initialised (model: ${model})`);
  }

  // ─── complete() ──────────────────────────────────────────────────────────

  async complete(params: LlmCompletionParams): Promise<LlmTextResponse> {
    const messages = this.toAnthropicMessages(params.messages);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages,
    });

    const response = await stream.finalMessage();

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

    return {
      text,
      stopReason: this.normaliseStopReason(response.stop_reason),
    };
  }

  // ─── completeWithTools() ─────────────────────────────────────────────────

  async completeWithTools(params: LlmToolCompletionParams): Promise<LlmToolResponse> {
    const messages = this.toAnthropicMessages(params.messages);

    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens,
      system: params.system,
      tools,
      messages,
      ...(params.toolChoice ? { tool_choice: { type: "tool" as const, name: params.toolChoice.name } } : {}),
    });

    const content: LlmResponseBlock[] = response.content.map((block) => {
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      // text block
      return {
        type: "text" as const,
        text: block.type === "text" ? block.text : "",
      };
    });

    return {
      content,
      stopReason: this.normaliseStopReason(response.stop_reason),
    };
  }

  // ─── Anthropic-specific message conversion ───────────────────────────────

  /**
   * Convert normalised LlmMessage[] to Anthropic's MessageParam[].
   *
   * Handles:
   *   - Plain text messages → string content
   *   - Document blocks → Anthropic "document" source blocks
   *   - Tool use/result blocks → native Anthropic tool blocks
   */
  private toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
    return messages.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }

      // Array of content parts → convert each
      const blocks: Anthropic.ContentBlockParam[] = msg.content.map((part) =>
        this.toAnthropicBlock(part)
      );

      return { role: msg.role, content: blocks };
    });
  }

  private toAnthropicBlock(part: LlmContentPart): Anthropic.ContentBlockParam {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text };

      case "document":
        // Anthropic native document input (PDF, images, etc.)
        return {
          type: "document",
          source: {
            type: "base64",
            media_type: part.mediaType,
            data: part.data,
          },
        } as any; // SDK types may lag behind API capabilities

      case "tool_use":
        return {
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: part.input,
        } as any;

      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: part.toolUseId,
          content: part.content,
        } as any;

      default:
        throw new Error(`Unknown content part type: ${(part as any).type}`);
    }
  }

  private normaliseStopReason(reason: string | null): string {
    if (!reason) { return "end_turn"; }
    // Anthropic uses "end_turn", "max_tokens", "tool_use"
    return reason;
  }

  dispose(): void {
    // Anthropic SDK has no explicit cleanup
    Logger.log("AnthropicProvider disposed");
  }
}
