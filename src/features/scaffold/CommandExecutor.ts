/**
 * CommandExecutor — Runs shell commands in a VS Code terminal.
 *
 * Uses the VS Code Terminal API (sendText) for command execution.
 * Output is captured by writing a sentinel line after the command,
 * then reading via a pty pseudo-terminal shell integration approach.
 *
 * Safety: all commands go through a user approval gate before running.
 */
import * as vscode from "vscode";
import { Logger } from "@shared/logger";

export class CommandExecutor implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;

  /**
   * Execute a command in the dedicated NeuroCode terminal.
   * Returns stdout/stderr as a combined string.
   */
  async execute(command: string, cwd?: string): Promise<{ output: string; exitCode: number }> {
    // `cd` is a shell builtin with no output — shell integration's read() stream never
    // terminates for it, causing a hang until the 120 s timeout. Callers should use the
    // `cwd` parameter instead; intercept here as a safety net.
    const cdMatch = command.trim().match(/^cd\s+("?.+"?|'.+'|\S+)$/);
    if (cdMatch) {
      Logger.log(`[CommandExecutor] Skipping bare 'cd' command (use cwd parameter instead): ${command}`);
      return { output: "", exitCode: 0 };
    }

    const terminal = this.getOrCreateTerminal(cwd);

    // Use shell integration API (VS Code 1.93+) if available for exit code capture.
    // Falls back to fire-and-forget with assumed success.
    if (terminal.shellIntegration) {
      return this.executeWithShellIntegration(terminal, command);
    }

    return this.executeFireAndForget(terminal, command);
  }

  private async executeWithShellIntegration(
    terminal: vscode.Terminal,
    command: string
  ): Promise<{ output: string; exitCode: number }> {
    const execution = terminal.shellIntegration!.executeCommand(command);
    const outputChunks: string[] = [];

    // Collect output
    for await (const chunk of execution.read()) {
      outputChunks.push(chunk);
    }

    // Exit code arrives via the onDidEndTerminalShellExecution event
    // Timeout after 120s to avoid blocking the agentic loop indefinitely
    const exitCode = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        disposable.dispose();
        Logger.warn(`[CommandExecutor] Command timed out (120s): ${command}`);
        resolve(1); // treat timeout as failure so Claude can recover
      }, 120_000);

      const disposable = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === execution) {
          clearTimeout(timer);
          disposable.dispose();
          resolve(e.exitCode ?? 0);
        }
      });
    });

    return { output: outputChunks.join(""), exitCode };
  }

  private async executeFireAndForget(
    terminal: vscode.Terminal,
    command: string
  ): Promise<{ output: string; exitCode: number }> {
    terminal.sendText(command, true);
    // Without shell integration we can't capture output or exit code reliably.
    // Wait briefly so the terminal has time to start, then return a placeholder.
    await new Promise((r) => setTimeout(r, 500));
    Logger.log(`[CommandExecutor] Sent (no shell integration): ${command}`);
    return { output: "(command sent to terminal — check terminal for output)", exitCode: 0 };
  }

  private getOrCreateTerminal(cwd?: string): vscode.Terminal {
    // Reuse existing terminal if still alive
    if (this.terminal && !this.isTerminalClosed(this.terminal)) {
      if (cwd) {
        // cd into target directory before running next command
        this.terminal.sendText(`cd "${cwd}"`, true);
      }
      return this.terminal;
    }

    this.terminal = vscode.window.createTerminal({
      name: "NeuroCode Scaffold",
      cwd,
      iconPath: new vscode.ThemeIcon("rocket"),
    });
    this.terminal.show(true); // show but don't steal focus
    return this.terminal;
  }

  private isTerminalClosed(terminal: vscode.Terminal): boolean {
    return !vscode.window.terminals.includes(terminal);
  }

  dispose(): void {
    this.terminal?.dispose();
    this.terminal = undefined;
  }
}
