/**
 * Built-in scaffold tools — registration entry point.
 *
 * Call registerBuiltinTools() during extension activation to populate
 * the ScaffoldToolRegistry with the default tool set.
 *
 * To add a new tool:
 *   1. Create a NeurocodeToolDef in tools/MyNewTool.ts
 *   2. Import it here
 *   3. Add it to the register call below
 *   — OR —
 *   Call ScaffoldToolRegistry.register(myTool) from anywhere at runtime.
 */
import { ScaffoldToolRegistry } from "../ScaffoldToolRegistry";
import { ExecuteCommandTool, disposeExecutor } from "./ExecuteCommandTool";
import { CreateFileTool } from "./CreateFileTool";
import { OpenInEditorTool } from "./OpenInEditorTool";

export function registerBuiltinTools(): void {
  ScaffoldToolRegistry.register(ExecuteCommandTool);
  ScaffoldToolRegistry.register(CreateFileTool);
  ScaffoldToolRegistry.register(OpenInEditorTool);
}

export { disposeExecutor };

// Re-export individual tools for direct access in tests
export { ExecuteCommandTool, CreateFileTool, OpenInEditorTool };
