/**
 * ExecuteCommandTool — Runs shell commands in a VS Code terminal.
 *
 * Self-contained tool module following Claude Code's pattern:
 * schema + execute + permission check + prompt fragment all in one place.
 */
import { CommandExecutor } from "../CommandExecutor";
import type { NeurocodeToolDef, ToolExecutionContext, ToolExecutionResult } from "@shared/types";

// Shared executor instance (reused across calls within a session)
let executor: CommandExecutor | undefined;

function getExecutor(): CommandExecutor {
  if (!executor) {
    executor = new CommandExecutor();
  }
  return executor;
}

export const ExecuteCommandTool: NeurocodeToolDef = {
  name: "execute_command",

  description(hints?: string[]): string {
    const base =
      "Run a shell command to scaffold the project (e.g. create-react-app, dotnet new, cargo init). " +
      "Always prefer official project-creation CLIs. Keep commands non-interactive (use --yes / -y flags). " +
      "Each command call must do one logical step only. " +
      "NEVER use `cd` as a standalone command — use the `cwd` parameter instead to set the working directory.";

    if (hints && hints.length > 0) {
      return base + "\n\nPreferred commands for this assignment:\n" +
        hints.map((h) => `- ${h}`).join("\n");
    }
    return base;
  },

  inputSchema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command (optional, defaults to workspace root)",
      },
      description: {
        type: "string",
        description: "One-line human-readable description of what this command does",
      },
    },
    required: ["command", "description"],
  },

  requiresApproval: true,
  isReadOnly: false,

  promptFragment:
    "- Use execute_command for CLI scaffolding steps.\n" +
    "- NEVER use `cd` as a standalone command. Use the `cwd` parameter of execute_command instead.\n" +
    "- NEVER retry a command that already returned exit code 0 — treat it as done.\n" +
    "- 'Requirement already satisfied' means the package IS installed — do NOT install it again.",

  async call(
    input: Record<string, string>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { command, cwd: relativeCwd, description } = input;
    const path = require("path");
    const resolvedCwd = relativeCwd
      ? path.resolve(context.workspaceRoot, relativeCwd)
      : context.workspaceRoot;

    context.onProgress(`Requesting approval: ${description ?? command}`, false);

    const approved = await context.requestApproval(
      `Run command: \`${command}\``,
      `Directory: ${resolvedCwd}\n\n${description ?? ""}`
    );

    if (!approved) {
      return { toolUseId: context.toolUseId, success: false, output: "", error: "User rejected command." };
    }

    context.onProgress(`Running: ${command}`, false);

    try {
      const { output, exitCode } = await getExecutor().execute(command, resolvedCwd);
      if (exitCode !== 0) {
        return { toolUseId: context.toolUseId, success: false, output, error: `Exit code ${exitCode}` };
      }
      return { toolUseId: context.toolUseId, success: true, output };
    } catch (err) {
      return {
        toolUseId: context.toolUseId,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Dispose the shared executor (call on extension deactivation).
 */
export function disposeExecutor(): void {
  executor?.dispose();
  executor = undefined;
}
