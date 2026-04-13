/**
 * OpenInEditorTool — Opens a file in VS Code editor.
 *
 * Self-contained tool module: schema + execute + prompt.
 * This is a read-only tool (no side effects) and does not require approval.
 */
import * as vscode from "vscode";
import * as path from "path";
import type { NeurocodeToolDef, ToolExecutionContext, ToolExecutionResult } from "@shared/types";

export const OpenInEditorTool: NeurocodeToolDef = {
  name: "open_in_editor",

  description(_hints?: string[]): string {
    return (
      "Open a file in the VS Code editor after scaffolding is complete. " +
      "Call this last, for the file the student should start editing."
    );
  },

  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative file path from the workspace root to open",
      },
    },
    required: ["path"],
  },

  requiresApproval: false,
  isReadOnly: true,

  promptFragment:
    "- Use open_in_editor ONCE at the very end to open the main entry-point file.\n" +
    "- After creating all files, call open_in_editor on the main entry file, then stop.",

  async call(
    input: Record<string, string>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { path: relativePath } = input;
    const absolutePath = path.resolve(context.workspaceRoot, relativePath);

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      context.onProgress(`Opened: ${relativePath}`, false);
      return { toolUseId: context.toolUseId, success: true, output: `Opened ${relativePath} in editor.` };
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
