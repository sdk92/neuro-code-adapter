/**
 * Extension entry point — VS Code extension activation and lifecycle.
 *
 * REFACTORED:
 *   1. Registers built-in profiles via ProfileRegistry on activation
 *   2. Uses ConfigService for centralised config management
 *      (eliminates manual API key propagation in onDidChangeConfiguration)
 *   3. Fixes DRY violation: export progress command delegates to controller
 *   4. Removed duplicated onDidChangeConfiguration handler
 *      (ConfigService handles this internally)
 */
import * as vscode from "vscode";
import { Logger } from "@shared/logger";
import { WebviewManager } from "@core/webview/WebviewManager";
import { NeurocodeController } from "@core/controller/NeurocodeController";
import { ConfigService } from "@shared/ConfigService";
import { registerBuiltinProfiles } from "@features/adaptive/builtinProfiles";
import { registerBuiltinTools } from "@features/scaffold/tools";

let controller: NeurocodeController | undefined;

/**
 * Called when the extension is activated.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startTime = performance.now();

  // 1. Initialize logging
  const outputChannel = vscode.window.createOutputChannel("NeuroCode Adapter");
  Logger.initialize(outputChannel);
  context.subscriptions.push(outputChannel);
  Logger.log("NeuroCode Adapter activating...");

  // 2. Register built-in neurodiversity profiles
  //    This must happen before any subsystem that reads from ProfileRegistry.
  registerBuiltinProfiles();
  Logger.log("Built-in profiles registered");

  // 2b. Register built-in scaffold tools
  //     This must happen before ScaffoldEngine is used.
  registerBuiltinTools();
  Logger.log("Built-in scaffold tools registered");

  // 3. Create ConfigService (centralised config management)
  const configService = new ConfigService();
  context.subscriptions.push(configService);

  // 4. Create WebviewManager (sidebar provider)
  const webviewManager = new WebviewManager(context.extensionUri);

  // 5. Register webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WebviewManager.VIEW_ID,
      webviewManager,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // 6. Create the central controller (receives ConfigService)
  controller = new NeurocodeController(context, webviewManager, configService);
  context.subscriptions.push(controller);

  // 7. Register commands
  registerCommands(context, controller);

  // NOTE: onDidChangeConfiguration for API key is now handled by ConfigService.
  // No manual propagation code needed here — see ConfigService.ts.

  const elapsed = Math.round(performance.now() - startTime);
  Logger.log(`NeuroCode Adapter activated in ${elapsed}ms`);
}

/**
 * Register all VS Code commands.
 *
 * REFACTORED: exportProgress now delegates entirely to controller,
 * fixing the DRY violation where the same save-dialog + writeFile
 * logic existed in both extension.ts and NeurocodeController.
 */
function registerCommands(
  context: vscode.ExtensionContext,
  ctrl: NeurocodeController
): void {
  const commands: Array<[string, () => void | Promise<void>]> = [
    ["neurocode.openAssignment", () => ctrl.promptAndLoadAssignment()],
    ["neurocode.configurePreferences", () => ctrl.showPreferencesPanel()],
    ["neurocode.getAIHelp", () => ctrl.requestAdaptation("help_request")],
    ["neurocode.scaffoldProject", () => ctrl.requestScaffold()],
    ["neurocode.showDashboard", () => ctrl.showDashboard()],
    // FIX: Was duplicating the export logic inline. Now delegates to controller.
    ["neurocode.exportProgress", () => ctrl.handleExportProgress()],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, handler)
    );
  }

  Logger.log(`Registered ${commands.length} commands`);
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
  Logger.log("NeuroCode Adapter deactivated");
}
