/**
 * Extension entry point — VS Code extension activation and lifecycle.
 *
 * Design pattern: Follows Cline's extension.ts activation flow:
 *   1. Set up host environment
 *   2. Run migrations (if any)
 *   3. Initialize core services
 *   4. Register commands and providers
 *   5. Expose public API
 *
 * Cline's extension.ts is 751 lines with complex migration logic,
 * test mode, multi-platform host setup, etc. We keep ours focused:
 *   1. Initialize Logger
 *   2. Create WebviewManager
 *   3. Create NeurocodeController (the central hub)
 *   4. Register commands
 *   5. Register webview provider
 */
import * as vscode from "vscode";
import { Logger } from "@shared/logger";
import { WebviewManager } from "@core/webview/WebviewManager";
import { NeurocodeController } from "@core/controller/NeurocodeController";

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

  // 2. Create WebviewManager (sidebar provider)
  const webviewManager = new WebviewManager(context.extensionUri);

  // 3. Register webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WebviewManager.VIEW_ID,
      webviewManager,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // 4. Create the central controller
  controller = new NeurocodeController(context, webviewManager);
  context.subscriptions.push(controller);

  // 5. Register commands
  registerCommands(context, controller);

  // 6. Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("neurocode.anthropicApiKey")) {
        const config = vscode.workspace.getConfiguration("neurocode");
        const apiKey = config.get<string>("anthropicApiKey", "");
        controller?.adaptationEngine.setApiKey(apiKey);
        controller?.assignmentManager.setApiKey(apiKey);
        controller?.scaffoldEngine.setApiKey(apiKey);
      }
    })
  );

  const elapsed = Math.round(performance.now() - startTime);
  Logger.log(`NeuroCode Adapter activated in ${elapsed}ms`);
}

/**
 * Register all VS Code commands.
 */
function registerCommands(
  context: vscode.ExtensionContext,
  ctrl: NeurocodeController
): void {
  const commands: Array<[string, () => void | Promise<void>]> = [
    ["neurocode.openAssignment", () => ctrl.promptAndLoadAssignment()],
    ["neurocode.importAssignment", () => ctrl.promptAndLoadAssignment()],
    ["neurocode.configurePreferences", () => ctrl.showPreferencesPanel()],
    ["neurocode.toggleAdaptiveMode", () => ctrl.toggleAdaptiveMode()],
    ["neurocode.getAIHelp", () => ctrl.requestAdaptation("help_request")],
    ["neurocode.scaffoldProject", () => ctrl.requestScaffold()],
    ["neurocode.showDashboard", () => ctrl.showDashboard()],
    ["neurocode.exportProgress", async () => {
      try {
        const report = await ctrl.assignmentManager.exportProgress();
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file("neurocode-progress.json"),
          filters: { "JSON Files": ["json"] },
        });
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(report, "utf-8"));
          vscode.window.showInformationMessage("Progress exported successfully");
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Export failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }],
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
