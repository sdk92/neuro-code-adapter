/**
 * WebviewManager — Manages the VS Code Webview sidebar panel.
 *
 * Design pattern: Inspired by Cline's WebviewProvider + ExtensionMessage/WebviewMessage protocol.
 *
 * Cline uses a structured message protocol with discriminated unions for
 * type-safe bidirectional communication. We adopt the same pattern with
 * our domain-specific message types defined in shared/messages.ts.
 *
 * Key responsibilities:
 *   - Create and manage the sidebar webview panel
 *   - Send ExtensionMessages to the webview
 *   - Receive and route WebviewMessages from the UI
 *   - Manage webview lifecycle (dispose, visibility)
 */
import * as vscode from "vscode";
import type { ExtensionMessage, ExtensionState, WebviewMessage } from "@shared/messages";
import { Logger } from "@shared/logger";

type MessageHandler = (message: WebviewMessage) => void;

export class WebviewManager implements vscode.WebviewViewProvider {
  static readonly VIEW_ID = "neurocode.sidebarView";

  private webviewView: vscode.WebviewView | undefined;
  private messageHandlers: MessageHandler[] = [];
  private pendingMessages: ExtensionMessage[] = [];
  private extensionUri: vscode.Uri;
  private cachedHtmlContent: string | null = null; // Cache HTML for late-opening sidebar

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Called by VS Code when the webview view is resolved.
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // If HTML was set before sidebar was opened, restore it now.
    // Otherwise show default welcome page.
    webviewView.webview.html = this.cachedHtmlContent ?? this.getDefaultHtml();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      Logger.debug(`Webview message received: ${message.type}`);
      for (const handler of this.messageHandlers) {
        try {
          handler(message);
        } catch (error) {
          Logger.error("Webview message handler error:", error);
        }
      }
    });

    // Send any pending messages
    for (const msg of this.pendingMessages) {
      this.postMessage(msg);
    }
    this.pendingMessages = [];

    webviewView.onDidDispose(() => {
      this.webviewView = undefined;
    });

    Logger.log("Webview resolved and ready");
  }

  /**
   * Send a typed message to the webview.
   */
  postMessage(message: ExtensionMessage): void {
    if (this.webviewView?.webview) {
      this.webviewView.webview.postMessage(message);
    } else {
      // Queue messages until webview is ready
      this.pendingMessages.push(message);
    }
  }

  /**
   * Send full state update to webview.
   */
  sendStateUpdate(state: Partial<ExtensionState>): void {
    this.postMessage({ type: "state_update", state });
  }

  /**
   * Send error to webview.
   */
  sendError(code: string, message: string): void {
    this.postMessage({ type: "error", code, message });
  }

  /**
   * Send info message to webview.
   */
  sendInfo(message: string): void {
    this.postMessage({ type: "info", message });
  }

  /**
   * Register a handler for webview messages.
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Update the webview HTML content (e.g., with adapted assignment view).
   * Caches content so it's available if sidebar is opened later.
   */
  setHtmlContent(html: string): void {
    this.cachedHtmlContent = html;
    if (this.webviewView?.webview) {
      this.webviewView.webview.html = html;
    }
    // If webview not yet resolved, cachedHtmlContent will be applied in resolveWebviewView
  }

  /**
   * Check if webview is currently visible.
   */
  isVisible(): boolean {
    return this.webviewView?.visible ?? false;
  }

  /**
   * Default sidebar HTML shown before any assignment is loaded.
   */
  private getDefaultHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NeuroCode Adapter</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 16px;
    }
    h1 { font-size: 1.4em; margin-bottom: 0.5em; }
    .welcome { text-align: center; padding: 2em 1em; }
    .welcome p { color: var(--vscode-descriptionForeground); margin: 0.5em 0; }
    .btn {
      display: inline-block; margin: 0.5em;
      padding: 0.6em 1.2em;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 4px;
      cursor: pointer; font-size: 0.9em;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .status { margin-top: 2em; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="welcome">
    <h1>NeuroCode Adapter</h1>
    <p>Adaptive programming assignments for neurodiverse learners</p>
    <p>
      <button class="btn" onclick="sendMessage('open_assignment')">Open Assignment</button>
      <button class="btn" onclick="sendMessage('configure_prefs')">Configure Preferences</button>
    </p>
    <div class="status" id="status">Ready</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function sendMessage(type) {
      if (type === 'open_assignment') {
        vscode.postMessage({ type: 'open_assignment', filePath: '' });
      } else if (type === 'configure_prefs') {
        vscode.postMessage({ type: 'open_preferences' });
      }
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'info') {
        document.getElementById('status').textContent = msg.message;
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.messageHandlers = [];
    this.pendingMessages = [];
  }
}
