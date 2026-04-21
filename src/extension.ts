/**
 * Extension entry point — VS Code extension activation and lifecycle.
 *
 * REFACTORED (M1):
 *   - Now initializes PromptTemplateStore from resources/prompts/ during activation
 *   - PromptBuilder is constructed over the store and injected into the controller
 *   - Activation fails fast with a clear error if templates can't be loaded
 *
 * Activation order (order matters — each step depends on the previous):
 *   1. Output channel + Logger
 *   2. ProfileRegistry (built-in profiles)
 *   3. ScaffoldToolRegistry (built-in tools)
 *   4. PromptTemplateStore (loads templates from disk — NEW)
 *   5. ConfigService
 *   6. WebviewManager
 *   7. NeurocodeController (receives everything above)
 *   8. Commands
 */
import * as vscode from "vscode";
import * as path from "path";
import { Logger } from "@shared/logger";
import { WebviewManager } from "@core/webview/WebviewManager";
import { NeurocodeController } from "@core/controller/NeurocodeController";
import { ConfigService } from "@shared/ConfigService";
import { registerBuiltinProfiles } from "@features/adaptive/builtinProfiles";
import { registerBuiltinTools } from "@features/scaffold/tools";
import { PromptTemplateStore, PromptBuilder } from "@services/prompts";

let controller: NeurocodeController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startTime = performance.now();

  // 1. Logging
  const outputChannel = vscode.window.createOutputChannel("NeuroCode Adapter");
  Logger.initialize(outputChannel);
  context.subscriptions.push(outputChannel);
  Logger.log("NeuroCode Adapter activating...");

  // 2. Profiles
  registerBuiltinProfiles();
  Logger.log("Built-in profiles registered");

  // 3. Scaffold tools
  registerBuiltinTools();
  Logger.log("Built-in scaffold tools registered");

  // 4. Prompt templates — NEW (M1)
  //    Fail fast if templates can't load: the extension is non-functional without them
  //    for anything but the rule-based fallback path.
  const promptsDir = path.join(context.extensionPath, "resources", "prompts");
  const promptTemplateStore = new PromptTemplateStore(promptsDir);
  try {
    await promptTemplateStore.load();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.error("Failed to load prompt templates:", err);
    vscode.window.showErrorMessage(
      `NeuroCode Adapter: prompt templates failed to load. ` +
      `LLM features will not work. Reinstall the extension if the problem persists. ` +
      `Details: ${msg}`,
    );
    // Continue activation anyway — rule-based fallback still works without templates.
  }
  const promptBuilder = new PromptBuilder(promptTemplateStore);
  // Register store for disposal on deactivation
  context.subscriptions.push({ dispose: () => promptTemplateStore.dispose() });

  // 5. Config
  const configService = new ConfigService();
  context.subscriptions.push(configService);

  // 6. Webview
  const webviewManager = new WebviewManager(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WebviewManager.VIEW_ID,
      webviewManager,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // 7. Controller — receives the PromptBuilder
  controller = new NeurocodeController(context, webviewManager, configService, promptBuilder);
  context.subscriptions.push(controller);

  // 8. Commands
  registerCommands(context, controller);

  const elapsed = Math.round(performance.now() - startTime);
  Logger.log(`NeuroCode Adapter activated in ${elapsed}ms`);
}

function registerCommands(
  context: vscode.ExtensionContext,
  ctrl: NeurocodeController,
): void {
  const commands: Array<[string, () => void | Promise<void>]> = [
    ["neurocode.openAssignment", () => ctrl.promptAndLoadAssignment()],
    ["neurocode.configurePreferences", () => ctrl.showPreferencesPanel()],
    // ["neurocode.getAIHelp", () => ctrl.requestAdaptation("help_request")],
    ["neurocode.scaffoldProject", () => ctrl.requestScaffold()],
    ["neurocode.fullAdaptation", () => ctrl.requestAdaptation("full_adaptation")],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  Logger.log(`Registered ${commands.length} commands`);
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
  Logger.log("NeuroCode Adapter deactivated");
}
