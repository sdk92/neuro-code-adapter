/**
 * McpServer — NeuroCode MCP server implementation.
 *
 * This server exposes tools that the LLM can invoke:
 *   - adapt_assignment: Generate adapted view of an assignment section
 *   - analyze_struggle: Analyze student struggle and suggest interventions
 *   - provide_hint: Generate a context-aware hint
 *   - evaluate_code: Evaluate student code against assignment criteria
 *
 * The server integrates with Anthropic's Claude API for LLM generation.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "@shared/logger";

/**
 * Tool definitions for the NeuroCode MCP server.
 */
const TOOL_DEFINITIONS = [
  {
    name: "adapt_assignment",
    description:
      "Generate an adapted presentation of an assignment section based on " +
      "the student's neurodiversity profile and current session context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sectionContent: { type: "string", description: "Original section content in Markdown" },
        sectionTitle: { type: "string", description: "Section title" },
        neurodiversityType: {
          type: "string",
          enum: ["neurotypical", "dyslexia", "autism", "adhd"],
          description: "Student's neurodiversity profile type",
        },
        preferences: { type: "object", description: "User visual/structural/cognitive preferences" },
        sessionSummary: { type: "object", description: "Current session context summary" },
      },
      required: ["sectionContent", "neurodiversityType"],
    },
  },
  {
    name: "analyze_struggle",
    description:
      "Analyze student struggle indicators and generate supportive interventions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        struggleIndicators: {
          type: "array",
          items: { type: "object" },
          description: "List of detected struggle indicators",
        },
        currentSection: { type: "string", description: "Current assignment section" },
        neurodiversityType: { type: "string", description: "Student's profile type" },
        sessionSummary: { type: "object", description: "Session context summary" },
      },
      required: ["struggleIndicators", "neurodiversityType"],
    },
  },
  {
    name: "provide_hint",
    description:
      "Generate a context-aware hint for the student based on their current progress.",
    inputSchema: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "Student's question or help request" },
        sectionContent: { type: "string", description: "Current section content" },
        neurodiversityType: { type: "string", description: "Student's profile type" },
        codeContext: { type: "string", description: "Relevant code from student's workspace" },
      },
      required: ["question", "neurodiversityType"],
    },
  },
  {
    name: "evaluate_code",
    description:
      "Evaluate student code against assignment criteria with neurodiversity-aware feedback.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "Student's code" },
        language: { type: "string", description: "Programming language" },
        assignmentCriteria: { type: "string", description: "Assignment requirements" },
        neurodiversityType: { type: "string", description: "Student's profile type" },
      },
      required: ["code", "language", "neurodiversityType"],
    },
  },
];

/**
 * Create and start the MCP server.
 * Called as a standalone process (stdio transport).
 */
export function createMcpServer(
  handleToolCall: (toolName: string, args: Record<string, unknown>) => Promise<string>
): Server {
  const server = new Server(
    { name: "neurocode-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, (args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error(`Tool call error (${name}):`, error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server with stdio transport.
 */
export async function startMcpServer(
  handleToolCall: (toolName: string, args: Record<string, unknown>) => Promise<string>
): Promise<void> {
  const server = createMcpServer(handleToolCall);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.log("NeuroCode MCP server started on stdio");
}
