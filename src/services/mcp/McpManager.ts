/**
 * McpManager — Central MCP connection lifecycle manager.
 *
 * Design pattern: Directly inspired by Cline's McpHub.ts.
 *
 * Key patterns borrowed from McpHub:
 *   1. Connection state machine: connecting → connected → disconnected
 *   2. Typed connection objects holding client + transport + server info
 *   3. Reconnection with exponential backoff
 *   4. Error accumulation via appendErrorMessage pattern
 *   5. Tool/resource discovery after connection
 *   6. Transport type switching (McpHub lines 382–531)
 *
 * Supported transports (mirrors McpHub's switch on expandedConfig.type):
 *   - "stdio": Local subprocess via stdin/stdout (for local MCP servers)
 *   - "streamableHttp": Remote server via HTTP (for cloud/shared MCP servers)
 *
 * Simplifications from McpHub:
 *   - Single server connection (not multi-server orchestration)
 *   - No SSE transport (deprecated in favour of streamableHttp)
 *   - No OAuth, no marketplace, no enterprise features
 *
 * Our additions:
 *   - Adaptation-specific tool definitions
 *   - Session context passing to server
 *   - Response schema validation
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerInfo, McpToolInfo, McpToolCallResult, McpConnectionStatus } from "@shared/types";
import { Logger } from "@shared/logger";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2_000;

// ─── Transport type definitions ──────────────────────────────────────────────
// Mirrors Cline's McpHub approach: a union type for transport,
// and a discriminated config type to select which transport to create.

type Transport = StdioClientTransport | StreamableHTTPClientTransport;

/**
 * Stdio config — MCP server runs as a local subprocess.
 * Use when the server is on the same machine as VS Code.
 */
export interface StdioServerConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * StreamableHTTP config — MCP server is a remote HTTP endpoint.
 * Use when the server is deployed on a cloud/school server.
 */
export interface HttpServerConfig {
  type: "streamableHttp";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioServerConfig | HttpServerConfig;

interface McpConnection {
  client: Client;
  transport: Transport;
  server: McpServerInfo;
  config: McpServerConfig; // Store config for reconnection
}

type StatusChangeCallback = (server: McpServerInfo) => void;

export class McpManager {
  private connection: McpConnection | null = null;
  private reconnectAttempts = 0;
  private statusChangeCallbacks: StatusChangeCallback[] = [];

  /**
   * Register a callback for connection status changes.
   * Inspired by McpHub's notifyWebviewOfServerChanges pattern.
   */
  onStatusChange(callback: StatusChangeCallback): void {
    this.statusChangeCallbacks.push(callback);
  }

  /**
   * Connect to an MCP server.
   *
   * Mirrors McpHub.connectToServer() with switch on config.type:
   *   - "stdio":          StdioClientTransport (local subprocess)
   *   - "streamableHttp": StreamableHTTPClientTransport (remote HTTP)
   *
   * Flow (identical for both transports):
   *   1. Create Client with capabilities
   *   2. Create transport based on config type
   *   3. Register error/close handlers
   *   4. Connect and discover tools
   */
  async connect(config: McpServerConfig): Promise<void> {
    // Disconnect existing connection first (McpHub pattern)
    if (this.connection) {
      await this.disconnect();
    }

    const serverInfo: McpServerInfo = {
      name: config.type === "stdio"
        ? `local:${config.command}`
        : `remote:${config.url}`,
      status: "connecting",
      tools: [],
    };

    this.notifyStatusChange(serverInfo);

    try {
      const client = new Client(
        { name: "NeuroCode Adapter", version: "0.1.0" },
        { capabilities: {} }
      );

      // ─── Transport creation (mirrors McpHub lines 382–531) ─────
      let transport: Transport;

      switch (config.type) {
        case "stdio": {
          // Local subprocess transport
          transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            cwd: config.cwd,
            env: {
              ...getDefaultEnvironment(),
              ...(config.env ?? {}),
            },
            stderr: "pipe",
          });

          // Error handler — mirrors McpHub's transport.onerror for stdio
          transport.onerror = async (error) => {
            Logger.error("MCP stdio transport error:", error);
            if (this.connection) {
              this.connection.server.status = "disconnected";
              this.appendError(error instanceof Error ? error.message : String(error));
              this.notifyStatusChange(this.connection.server);
            }
          };

          // Close handler
          transport.onclose = async () => {
            Logger.warn("MCP stdio transport closed");
            if (this.connection) {
              this.connection.server.status = "disconnected";
              this.notifyStatusChange(this.connection.server);
            }
          };

          // Start transport and capture stderr for diagnostics
          await transport.start();
          const stderrStream = (transport as any).stderr;
          if (stderrStream) {
            stderrStream.on("data", (data: Buffer) => {
              const output = data.toString();
              if (/\berror\b/i.test(output)) {
                Logger.error("MCP server stderr:", output);
                if (this.connection) { this.appendError(output); }
              } else {
                Logger.debug("MCP server info:", output);
              }
            });
          }

          // Prevent double-start (McpHub pattern, line 438)
          transport.start = async () => {};
          break;
        }

        case "streamableHttp": {
          // Remote HTTP transport
          // McpHub wraps fetch to normalise 404→405 for GET requests (line 499–508).
          // We adopt the same workaround for server compatibility.
          const httpFetch: typeof globalThis.fetch = async (url, init) => {
            const response = await globalThis.fetch(url, init);
            if (init?.method === "GET" && response.status === 404) {
              return new Response(response.body, {
                status: 405,
                statusText: "Method Not Allowed",
                headers: response.headers,
              });
            }
            return response;
          };

          transport = new StreamableHTTPClientTransport(
            new URL(config.url),
            {
              requestInit: {
                headers: config.headers ?? undefined,
              },
              fetch: httpFetch,
            }
          );

          // Error handler — mirrors McpHub's transport.onerror for HTTP
          transport.onerror = async (error) => {
            Logger.error("MCP HTTP transport error:", error);
            if (this.connection) {
              this.connection.server.status = "disconnected";
              this.appendError(error instanceof Error ? error.message : String(error));
              this.notifyStatusChange(this.connection.server);
            }
            // Auto-reconnect for HTTP (network may be temporarily unavailable)
            this.attemptReconnect(config);
          };

          break;
        }

        default:
          throw new Error(`Unknown transport type: ${(config as any).type}`);
      }

      // ─── Connect client (common for both transports) ───────────
      await client.connect(transport);

      this.connection = { client, transport, server: serverInfo, config };
      this.connection.server.status = "connected";
      this.connection.server.error = undefined;
      this.reconnectAttempts = 0;

      // Discover tools (mirrors McpHub.fetchToolsList)
      this.connection.server.tools = await this.fetchTools();

      Logger.log(
        `MCP connected via ${config.type}. Tools: ${this.connection.server.tools.map((t) => t.name).join(", ")}`
      );
      this.notifyStatusChange(this.connection.server);

    } catch (error) {
      Logger.error("MCP connection failed:", error);
      serverInfo.status = "disconnected";
      serverInfo.error = error instanceof Error ? error.message : String(error);
      this.notifyStatusChange(serverInfo);

      // Attempt reconnection (inspired by McpHub's restartConnection)
      this.attemptReconnect(config);
    }
  }

  /**
   * Attempt reconnection with linear backoff.
   * Mirrors McpHub's restartConnection pattern.
   */
  private attemptReconnect(config: McpServerConfig): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      Logger.warn(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
      return;
    }
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
    Logger.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    setTimeout(() => this.connect(config), delay);
  }

  /**
   * Disconnect from the MCP server.
   * Mirrors McpHub.deleteConnection pattern.
   */
  async disconnect(): Promise<void> {
    if (!this.connection) { return; }

    try {
      await this.connection.transport.close();
      await this.connection.client.close();
    } catch (error) {
      Logger.error("Error during MCP disconnect:", error);
    }

    this.connection.server.status = "disconnected";
    this.notifyStatusChange(this.connection.server);
    this.connection = null;
  }

  /**
   * Call a tool on the MCP server.
   * Mirrors McpHub.callTool with timeout support.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    if (!this.connection || this.connection.server.status !== "connected") {
      throw new Error("MCP server not connected");
    }

    try {
      const result = await this.connection.client.request(
        {
          method: "tools/call",
          params: { name: toolName, arguments: args },
        },
        CallToolResultSchema,
        { timeout: DEFAULT_TIMEOUT_MS }
      );

      return {
        content: (result.content ?? []) as McpToolCallResult["content"],
        isError: result.isError,
      };
    } catch (error) {
      Logger.error(`MCP tool call failed (${toolName}):`, error);
      throw error;
    }
  }

  /**
   * Fetch available tools from the server.
   * Mirrors McpHub.fetchToolsList.
   */
  private async fetchTools(): Promise<McpToolInfo[]> {
    if (!this.connection?.client) { return []; }

    try {
      const response = await this.connection.client.request(
        { method: "tools/list" },
        ListToolsResultSchema,
        { timeout: DEFAULT_TIMEOUT_MS }
      );

      return (response?.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    } catch (error) {
      Logger.error("Failed to fetch MCP tools:", error);
      return [];
    }
  }

  /**
   * Append error message to server info.
   * McpHub pattern: accumulates errors for display.
   */
  private appendError(message: string): void {
    if (!this.connection) { return; }
    const existing = this.connection.server.error;
    this.connection.server.error = existing ? `${existing}\n${message}` : message;
  }

  /**
   * Notify all registered callbacks of status change.
   * Simplified version of McpHub.notifyWebviewOfServerChanges.
   */
  private notifyStatusChange(server: McpServerInfo): void {
    for (const callback of this.statusChangeCallbacks) {
      try {
        callback({ ...server });
      } catch (error) {
        Logger.error("Status change callback error:", error);
      }
    }
  }

  /**
   * Get current server info.
   */
  getServerInfo(): McpServerInfo | null {
    return this.connection ? { ...this.connection.server } : null;
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connection?.server.status === "connected";
  }

  async dispose(): Promise<void> {
    await this.disconnect();
    this.statusChangeCallbacks = [];
  }
}
