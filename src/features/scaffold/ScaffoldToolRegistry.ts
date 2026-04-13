/**
 * ScaffoldToolRegistry — Central registry for scaffold tools.
 *
 * Inspired by Claude Code's tools.ts which serves as the single source
 * of truth for combining built-in tools with MCP tools.
 *
 * The registry:
 *   - Stores all registered NeurocodeToolDef instances
 *   - Provides lookup by name for the agentic loop dispatcher
 *   - Builds the Anthropic API tool list for LLM consumption
 *   - Collects prompt fragments from all tools
 *
 * Adding a new tool:
 *   1. Create a NeurocodeToolDef object
 *   2. Call ScaffoldToolRegistry.register(myTool)
 *   3. Done — the agentic loop and LLM will see it automatically
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { NeurocodeToolDef } from "@shared/types";

export type AnthropicTool = Anthropic.Tool;

const tools = new Map<string, NeurocodeToolDef>();

export const ScaffoldToolRegistry = {
  /**
   * Register a tool. Overwrites any existing tool with the same name.
   */
  register(tool: NeurocodeToolDef): void {
    tools.set(tool.name, tool);
  },

  /**
   * Look up a tool by name. Returns undefined if not found.
   */
  get(name: string): NeurocodeToolDef | undefined {
    return tools.get(name);
  },

  /**
   * Get all registered tools.
   */
  getAll(): NeurocodeToolDef[] {
    return [...tools.values()];
  },

  /**
   * Get all tool names.
   */
  getNames(): string[] {
    return [...tools.keys()];
  },

  /**
   * Build the Anthropic API tool array for the LLM.
   * Optionally injects description hints (e.g. language-specific commands).
   *
   * @param hintsByTool - Map of tool name → string[] hints to append to description
   */
  buildAnthropicTools(hintsByTool?: Map<string, string[]>): AnthropicTool[] {
    return [...tools.values()].map((tool) => {
      const hints = hintsByTool?.get(tool.name);
      return {
        name: tool.name,
        description: tool.description(hints),
        input_schema: tool.inputSchema as AnthropicTool["input_schema"],
      };
    });
  },

  /**
   * Collect prompt fragments from all registered tools.
   * Used to inject tool-specific guidance into the system prompt.
   */
  buildPromptFragments(): string {
    return [...tools.values()]
      .filter((t) => t.promptFragment)
      .map((t) => t.promptFragment!)
      .join("\n");
  },

  /**
   * Clear all registrations (useful for testing).
   */
  clear(): void {
    tools.clear();
  },

  /**
   * Number of registered tools.
   */
  get count(): number {
    return tools.size;
  },
};
