/**
 * CreateFileTool — Creates or overwrites files in the workspace.
 *
 * Self-contained tool module: schema + execute + permission check + prompt.
 */
import * as vscode from "vscode";
import * as path from "path";
import type { NeurocodeToolDef, ToolExecutionContext, ToolExecutionResult } from "@shared/types";

export const CreateFileTool: NeurocodeToolDef = {
  name: "create_file",

  description(_hints?: string[]): string {
    return (
      "Create or overwrite a file with the given content. " +
      "Use this to add starter code, config files, or README. " +
      "Prefer this over running echo/cat in execute_command."
    );
  },

  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative file path from the workspace root",
      },
      content: {
        type: "string",
        description: "Full file content",
      },
      description: {
        type: "string",
        description: "One-line description of what this file is",
      },
    },
    required: ["path", "content", "description"],
  },

  requiresApproval: true,
  isReadOnly: false,

  promptFragment:
    "- Use create_file to add or overwrite individual source files.\n" +
    "- Once the environment is set up (venv created, packages installed), " +
    "IMMEDIATELY move on to creating source files with create_file.",

  async call(
    input: Record<string, string>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { path: relativePath, content, description } = input;
    const absolutePath = path.resolve(context.workspaceRoot, relativePath);

    context.onProgress(`Requesting approval: create ${relativePath}`, false);

    const approved = await context.requestApproval(
      `Create file: \`${relativePath}\``,
      description ?? ""
    );

    if (!approved) {
      return { toolUseId: context.toolUseId, success: false, output: "", error: "User rejected file creation." };
    }

    try {
      const uri = vscode.Uri.file(absolutePath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
      context.onProgress(`Created: ${relativePath}`, false);
      return { toolUseId: context.toolUseId, success: true, output: `File created: ${relativePath}` };
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
