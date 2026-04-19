/**
 * NeurocodeController — Central orchestration hub.
 *
 * Design pattern: Directly inspired by Cline's Controller class (index1.ts, 1044 lines)
 * and Task class (index.ts, 3764 lines).
 *
 * Patterns borrowed from Controller (index1.ts):
 *   - Owns all subsystem instances (McpHub, AuthService, StateManager, etc.)
 *   - cancelInProgress flag to prevent duplicate operations (line 427)
 *   - initTask() creates Task with dependency injection via callbacks (line 306)
 *   - postStateToWebview() called after every state change for consistency
 *   - clearTask() + dispose() for proper lifecycle cleanup
 *
 * Patterns borrowed from Task (index.ts):
 *   - stateMutex + withStateLock() for thread-safe state modifications (line 169)
 *   - TaskState as a separate state object (line 166)
 *   - Three context trackers initialized in constructor (line 382-384)
 *   - MCP notification callback forwarding to UI (line 352-355)
 *   - Callback injection: updateTaskHistory, postStateToWebview passed as params
 *
 * Our Controller orchestrates:
 *   - McpManager (MCP connection lifecycle)
 *   - AdaptationEngine (LLM interaction)
 *   - PreferenceManager (user preferences)
 *   - AssignmentManager (assignment lifecycle)
 *   - AdaptiveRenderer (view generation)
 *   - WebviewManager (UI communication)
 */
import * as vscode from "vscode";
import { WebviewManager } from "@core/webview/WebviewManager";
import { McpManager } from "@services/mcp/McpManager";
import { AdaptationEngine } from "@services/llm/AdaptationEngine";
import type { LlmProvider } from "@services/llm/LlmProvider";
import { tryCreateProvider } from "@services/llm/ProviderFactory";
import { PreferenceManager } from "@features/preferences/PreferenceManager";
import { AssignmentManager } from "@features/assignments/AssignmentManager";
import { AdaptiveRenderer } from "@features/adaptive/AdaptiveRenderer";
import { ScaffoldEngine } from "@features/scaffold/ScaffoldEngine";
import type { WebviewMessage } from "@shared/messages";
import type { AdaptationRequest, AdaptationResponse, Assignment } from "@shared/types";
import { Logger } from "@shared/logger";
import { ConfigService } from "@shared/ConfigService";
import { validateWebviewMessage } from "@shared/MessageValidator";
import type { PromptBuilder } from "@services/prompts";

// ─── AdaptationState (inspired by Cline's TaskState, line 166) ───────────────
// Cline's Task class uses a separate TaskState object to hold mutable state.
// We adopt this pattern for cleaner state management and easier testing.
interface AdaptationState {
  isAdapting: boolean;           // Whether an LLM adaptation is in progress
  isStreaming: boolean;          // Whether we're receiving streaming response
  lastAdaptationTimestamp: number | null;
  abandonedAdaptation: boolean;  // Mirrors Cline's Task.taskState.abandoned
}

function createInitialState(): AdaptationState {
  return {
    isAdapting: false,
    isStreaming: false,
    lastAdaptationTimestamp: null,
    abandonedAdaptation: false,
  };
}

export class NeurocodeController implements vscode.Disposable {
  // ─── Owned subsystems ────────────────────────────────────────────
  readonly mcpManager: McpManager;
  readonly adaptationEngine: AdaptationEngine;
  readonly preferenceManager: PreferenceManager;
  readonly assignmentManager: AssignmentManager;
  readonly renderer: AdaptiveRenderer;
  readonly scaffoldEngine: ScaffoldEngine;
  readonly webview: WebviewManager;
  readonly configService: ConfigService;

  // ─── State (inspired by Cline's TaskState pattern) ──────────────
  private adaptationState: AdaptationState = createInitialState();
  private currentAdaptation: AdaptationResponse | null = null;

  // ─── Concurrency guards (inspired by Cline Controller line 427) ─
  private adaptationInProgress = false;

  // ─── Current LLM provider ──────────────────────────────────────
  private currentProvider: LlmProvider | null = null;


  constructor(
    context: vscode.ExtensionContext,
    webview: WebviewManager,
    configService: ConfigService,
    promptBuilder: PromptBuilder,
  ) {
    // Initialize subsystems
    this.mcpManager = new McpManager();
    this.adaptationEngine = new AdaptationEngine();
    this.preferenceManager = new PreferenceManager(context);
    this.assignmentManager = new AssignmentManager(context);
    this.renderer = new AdaptiveRenderer();
    this.scaffoldEngine = new ScaffoldEngine();
    this.webview = webview;
    this.configService = configService;

    // M1: wire the PromptBuilder into subsystems that need it.
    this.adaptationEngine.setPromptBuilder(promptBuilder);
    this.assignmentManager.setPromptBuilder(promptBuilder);

    // Wire up connections
    this.setupMcpCallbacks();
    this.setupPreferenceCallbacks();
    this.setupWebviewMessageRouter();

    // REFACTORED: Create LLM provider from config and propagate to all subsystems.
    this.rebuildProvider(configService.getConfig());

    // Subscribe to future config changes that affect the provider
    const providerKeys = new Set(["llmProvider", "llmModel", "llmBaseUrl", "anthropicApiKey", "openaiApiKey"]);
    configService.onChange((config, changed) => {
      const affectsProvider = [...changed].some((k) => providerKeys.has(k));
      if (affectsProvider) {
        this.rebuildProvider(config);
      }
    });

    // Connect MCP manager to adaptation engine
    this.adaptationEngine.setMcpManager(this.mcpManager);

    Logger.log("NeurocodeController initialized");
  }

  // ─── Setup Methods ──────────────────────────────────────────────

  /**
   * Build an LLM provider from config and propagate to all subsystems.
   * REFACTORED: Replaces propagateApiKey(). Now provider-agnostic.
   */
  private rebuildProvider(config: ReturnType<ConfigService["getConfig"]>): void {
    // Dispose old provider
    this.currentProvider?.dispose();

    // Resolve the active API key based on provider type
    const apiKey = config.llmProvider === "openai"
      ? config.openaiApiKey
      : config.anthropicApiKey;

    this.currentProvider = tryCreateProvider({
      provider: config.llmProvider,
      model: config.llmModel,
      apiKey,
      baseUrl: config.llmBaseUrl || undefined,
    });

    // Propagate to all subsystems
    this.adaptationEngine.setProvider(this.currentProvider);
    this.assignmentManager.setProvider(this.currentProvider);
    this.scaffoldEngine.setProvider(this.currentProvider ?? undefined);

    if (this.currentProvider) {
      Logger.log(`LLM provider: ${this.currentProvider.name} (${this.currentProvider.model})`);
    } else {
      Logger.log("No LLM provider configured — rule-based fallback active");
    }
  }

  /**
   * Wire MCP status changes to webview notifications.
   * Also sets up the notification callback (borrowed from Cline Task, line 352-355):
   *   this.mcpHub.setNotificationCallback(async (serverName, _level, message) => {
   *     await this.say("mcp_notification", `[${serverName}] ${message}`)
   *   })
   */
  private setupMcpCallbacks(): void {
    this.mcpManager.onStatusChange((server) => {
      this.webview.postMessage({ type: "mcp_status", server });
      // Post full state after connection change (Cline Controller pattern: postStateToWebview after every change)
      this.postStateToWebview();
    });
  }

  /**
   * Re-render with cached adaptation when preferences change.
   * Triggered by: profile switch (set_profile) or VS Code settings changes.
   * Note: re-adaptation only happens on explicit Apply (apply_preferences handler).
   */
  private setupPreferenceCallbacks(): void {
    this.preferenceManager.onPreferencesChanged(async (prefs) => {
      this.webview.postMessage({ type: "preferences_updated", preferences: prefs });

      // Re-render with cached adaptation — re-adaptation only happens on explicit Apply
      const assignment = this.assignmentManager.getCurrentAssignment();
      if (!assignment) { return; }
      await this.renderAdaptiveView(assignment);
    });
  }

  /**
   * Route webview messages to handlers.
   * This is the core message dispatch — inspired by Cline's Controller
   * handling of WebviewMessage types.
   */
  private setupWebviewMessageRouter(): void {
    this.webview.onMessage(async (raw: WebviewMessage) => {
      // REFACTORED: Validate incoming messages before processing.
      // Webview is an untrusted execution environment.
      const validation = validateWebviewMessage(raw);
      if (!validation.valid) {
        Logger.warn(`Invalid webview message rejected: ${validation.errors.join("; ")}`);
        return;
      }
      const message = validation.message!;

      try {
        await this.handleWebviewMessage(message);
      } catch (error) {
        Logger.error(`Error handling message ${message.type}:`, error);
        this.webview.sendError(
          "handler_error",
          `Failed to handle ${message.type}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }


  // ─── Message Handlers ───────────────────────────────────────────

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      // No frontend trigger — reserved for webview lifecycle init (auto-sent on load)
      case "ready":
        this.postStateToWebview();
        break;

      // No frontend trigger — reserved for manual state refresh (not wired to any button)
      case "request_state":
        this.postStateToWebview();
        break;

      // Triggered by: "Open Assignment" button in WebviewManager dashboard
      case "open_assignment":
        await this.promptAndLoadAssignment();
        break;

      // Triggered by: "Configure Preferences" button in WebviewManager dashboard
      case "open_preferences":
        this.showPreferencesPanel();
        break;

      // Triggered by: Help button on each section in AdaptiveRenderer
      case "request_help":
        await this.requestAdaptation("help_request", message.sectionId);
        break;

      // Triggered by: Apply button in PreferenceManager preferences panel
      case "apply_preferences":
        this.preferenceManager.updatePreferences(message.preferences);
        await this.requestAdaptation("full_adaptation");
        break;

      // Triggered by: Profile dropdown in PreferenceManager preferences panel
      case "set_profile":
        this.preferenceManager.setProfile(message.profile);
        break;

      // No corresponding frontend button — needs a Connect MCP input/button in the UI
      case "connect_mcp":
        await this.connectMcp(message.url);
        break;

      // No corresponding frontend button — needs a Disconnect MCP button in the UI
      case "disconnect_mcp":
        await this.mcpManager.disconnect();
        break;

      // No corresponding frontend button — needs a Scaffold button in the UI
      case "request_scaffold":
        await this.requestScaffold();
        break;
    }
  }

  // ─── Core Workflows ─────────────────────────────────────────────

  /**
   * Prompt user to select an assignment file.
   * Handles PDF/JSON/Markdown with loading feedback.
   */
  async promptAndLoadAssignment(): Promise<void> {
    let assignment;

    try {
      // Show loading indicator during file parsing (PDF can take several seconds)
      assignment = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "NeuroCode: Loading assignment...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "Selecting file..." });
          const result = await this.assignmentManager.promptImport();

          if (result) {
            progress.report({ message: "Rendering adaptive view..." });
          }
          return result;
        }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Logger.error("Failed to load assignment:", error);
      vscode.window.showErrorMessage(`NeuroCode: Failed to load assignment — ${msg}`);
      this.webview.sendError("load_failed", msg);
      return;
    }

    if (!assignment) {
      return; // User cancelled file dialog
    }

    this.clearSession();
    this.webview.postMessage({ type: "assignment_loaded", assignment });
    await this.renderAdaptiveView(assignment);
    this.postStateToWebview();

    vscode.window.showInformationMessage(
      `NeuroCode: Loaded "${assignment.metadata.title}" (${assignment.sections.length} sections)`
    );
  }

  /**
   * Request an LLM adaptation and render the result.
   *
   * Concurrency guard pattern borrowed from Cline Controller.cancelTask (line 425-493):
   *   - cancelInProgress flag prevents duplicate cancellations from spam clicking
   *   - try/finally ensures flag is always cleared
   *
   * State tracking pattern borrowed from Cline Task.taskState:
   *   - isAdapting/isStreaming flags mirror Task's isStreaming/didFinishAbortingStream
   *   - abandonedAdaptation mirrors Task's taskState.abandoned
   *
   * Workflow:
   *   1. Guard against concurrent requests
   *   2. Assemble context (assignment + preferences + session)
   *   3. Send to AdaptationEngine
   *   4. Validate response
   *   5. Render adaptive view
   *   6. Post state to webview (Controller pattern: postStateToWebview after every change)
   */
  async requestAdaptation(
    requestType: AdaptationRequest["requestType"],
    targetSectionId?: string
  ): Promise<void> {
    const assignment = this.assignmentManager.getCurrentAssignment();
    if (!assignment) {
      this.webview.sendError("no_assignment", "No assignment loaded");
      return;
    }

    const preferences = this.preferenceManager.getPreferences();

    // ─── Concurrency guard (Cline Controller.cancelInProgress pattern) ───
    if (this.adaptationInProgress) {
      Logger.log("[Controller] Adaptation already in progress, ignoring duplicate request");
      return;
    }
    this.adaptationInProgress = true;
    this.adaptationState.isAdapting = true;

    this.webview.postMessage({ type: "adaptation_progress", status: "started" });

    try {
      const request: AdaptationRequest = {
        assignment,
        userPreferences: preferences,
        requestType,
        targetSectionId,
      };

      this.adaptationState.isStreaming = true;
      this.currentAdaptation = await this.adaptationEngine.generateAdaptation(request);
      this.adaptationState.isStreaming = false;
      this.adaptationState.lastAdaptationTimestamp = Date.now();

      this.webview.postMessage({
        type: "adaptation_result",
        adaptation: this.currentAdaptation,
      });
      this.webview.postMessage({ type: "adaptation_progress", status: "complete" });

      await this.renderAdaptiveView(assignment, this.currentAdaptation, requestType);

    } catch (error) {
      Logger.error("Adaptation failed:", error);
      this.adaptationState.isStreaming = false;
      this.webview.postMessage({
        type: "adaptation_progress",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });

      // Fallback: render without LLM adaptation
      await this.renderAdaptiveView(assignment);
    } finally {
      // Always clear flags (Cline pattern: finally block ensures cleanup)
      this.adaptationInProgress = false;
      this.adaptationState.isAdapting = false;
    }

    // Post full state after adaptation (Controller pattern)
    this.postStateToWebview();
  }

  /**
   * Render the adaptive view in the webview panel.
   */
  private async renderAdaptiveView(
    assignment: Assignment,
    adaptation?: AdaptationResponse,
    requestType: "full_adaptation" | "help_request" = "full_adaptation"
  ): Promise<void> {
    const preferences = this.preferenceManager.getPreferences();
    const html = this.renderer.render(assignment, preferences, adaptation ?? this.currentAdaptation ?? undefined, requestType);
    this.webview.setHtmlContent(html);
  }

  /**
   * Connect to an MCP server.
   * Supports both local (stdio) and remote (HTTP) servers.
   */
  private async connectMcp(url: string): Promise<void> {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      // Remote HTTP server
      await this.mcpManager.connect({
        type: "streamableHttp",
        url,
      });
    } else {
      // Local stdio server — url is path to server script
      await this.mcpManager.connect({
        type: "stdio",
        command: "node",
        args: [url],
      });
    }
  }

  /**
   * Scaffold a starter project for the current assignment.
   * Resolves the workspace root, then runs the ScaffoldEngine agentic loop.
   */
  async requestScaffold(): Promise<void> {
    const assignment = this.assignmentManager.getCurrentAssignment();
    if (!assignment) {
      vscode.window.showErrorMessage("NeuroCode: Load an assignment before scaffolding.");
      return;
    }

    if (!this.scaffoldEngine.isAvailable) {
      vscode.window.showErrorMessage(
        "NeuroCode: Configure an LLM provider in settings to use scaffolding."
      );
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("NeuroCode: Open a workspace folder before scaffolding.");
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `NeuroCode: Scaffolding "${assignment.metadata.title}"...`,
        cancellable: false,
      },
      async (progress) => {
        try {
          await this.scaffoldEngine.run(
            { assignment, workspaceRoot },
            (message, isDone) => {
              progress.report({ message });
              this.webview.postMessage({
                type: "scaffold_progress",
                progress: { message, isDone },
              });
            }
          );
          vscode.window.showInformationMessage(
            `NeuroCode: Project scaffold complete for "${assignment.metadata.title}"`
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          Logger.error("Scaffold failed:", error);
          vscode.window.showErrorMessage(`NeuroCode: Scaffold failed — ${msg}`);
        }
      }
    );
  }

  /**
   * Post full extension state to webview.
   * Named to match Cline Controller's postStateToWebview() — called after every state change.
   *
   * Cline calls this method after: initTask, cancelTask, togglePlanActMode,
   * updateTelemetrySetting, handleAuthCallback, and every other state mutation.
   * We follow the same discipline.
   */
  private postStateToWebview(): void {
    this.webview.sendStateUpdate({
      isInitialized: true,
      currentAssignment: this.assignmentManager.getCurrentAssignment(),
      currentAdaptation: this.currentAdaptation,
      userPreferences: this.preferenceManager.getPreferences(),
      mcpServer: this.mcpManager.getServerInfo(),
      version: "0.1.0",
    });
  }

  /**
   * Clear the current session and reset state.
   * Inspired by Cline Controller.clearTask() (line 1006-1013):
   *   async clearTask() {
   *     if (this.task) { await this.stateManager.clearTaskSettings() }
   *     await this.task?.abortTask()
   *     this.task = undefined
   *   }
   */
  private clearSession(): void {
    if (this.adaptationState.isAdapting) {
      this.adaptationState.abandonedAdaptation = true;
    }
    this.currentAdaptation = null;
    this.adaptationState = createInitialState();
    Logger.log("Session cleared");
  }

  // ─── Public API for Commands ────────────────────────────────────

  /**
   * Show the preferences configuration panel.
   */
  showPreferencesPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      "neurocodePreferences",
      "NeuroCode Preferences",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.webview.html = this.wrapPreferencesHtml(
      this.preferenceManager.generatePreferencesHtml()
    );

    // Handle messages from the preferences panel webview
    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case "set_profile":
          this.preferenceManager.setProfile(message.profile);
          // Re-render panel with new profile defaults
          panel.webview.html = this.wrapPreferencesHtml(
            this.preferenceManager.generatePreferencesHtml()
          );
          break;
        case "apply_preferences":
          this.preferenceManager.updatePreferences(message.preferences);
          await this.requestAdaptation("full_adaptation");
          break;
      }
    });
  }

  private wrapPreferencesHtml(innerHtml: string): string {
    return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 2em; }
  h2 { margin-bottom: 1em; }
  h3 { margin: 1.5em 0 0.5em; color: var(--vscode-descriptionForeground); }
  label { display: block; margin: 0.5em 0; }
  select, input[type=range] { margin-left: 0.5em; }
  .hint { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin: 0.3em 0 0 0; }
</style>
</head><body>${innerHtml}</body></html>`;
  }

  /**
   * Show the dashboard/main view.
   */
  showDashboard(): void {
    this.postStateToWebview();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /**
   * Dispose all resources.
   * Mirrors Cline Controller.dispose() (line 167-178):
   *   async dispose() {
   *     if (this.remoteConfigTimer) { clearInterval(...) }
   *     await this.clearTask()
   *     this.mcpHub.dispose()
   *   }
   */
  dispose(): void {
    // Clear active session (Cline: await this.clearTask())
    this.clearSession();

    // Dispose subsystems
    this.mcpManager.dispose();
    this.adaptationEngine.dispose();
    this.preferenceManager.dispose();
    this.assignmentManager.dispose();
    this.configService.dispose();
    this.webview.dispose();
    Logger.log("NeurocodeController disposed");
  }
}
