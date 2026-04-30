/**
 * CommandExecutor — Runs shell commands via child_process.spawn.
 *
 * REFACTORED: dropped VS Code Terminal + shell integration entirely.
 * Reason: shell integration is unreliable in many Linux/root/SSH/container
 * setups (OSC 633 markers get swallowed by custom prompts or non-bash shells),
 * causing onDidEndTerminalShellExecution to never fire and every command to
 * stall on the 120s timeout (see scaffold logs from 2026-04-29).
 *
 * Now: spawn a child process per command, collect stdout/stderr directly,
 * return real exit codes, and stream live output to a dedicated OutputChannel
 * for user visibility.
 */
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as vscode from "vscode";
import { Logger } from "@shared/logger";

const DEFAULT_TIMEOUT_MS = 120_000;   // hard ceiling per command
const KILL_GRACE_MS = 2_000;          // SIGTERM → SIGKILL grace period
const MAX_OUTPUT_BYTES = 64 * 1024;   // cap to keep LLM context manageable

export class CommandExecutor implements vscode.Disposable {
  private outputChannel: vscode.OutputChannel | undefined;
  private readonly activeChildren = new Set<ChildProcess>();

  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  /**
   * Execute a command in a child process.
   * Returns combined stdout+stderr (interleaved by arrival order) and exit code.
   */
  async execute(command: string, cwd?: string): Promise<{ output: string; exitCode: number }> {
    // Bare-cd short-circuit kept for safety: the LLM is told not to emit `cd`,
    // but if it slips through, treat it as a no-op rather than spawning a shell
    // whose chdir wouldn't persist anyway.
    const cdMatch = command.trim().match(/^cd\s+("?.+"?|'.+'|\S+)$/);
    if (cdMatch) {
      Logger.log(`[CommandExecutor] Skipping bare 'cd' (use cwd parameter instead): ${command}`);
      return { output: "", exitCode: 0 };
    }

    const channel = this.getOrCreateChannel();
    channel.appendLine("");
    channel.appendLine(`$ ${command}`);
    if (cwd) {channel.appendLine(`  (cwd: ${cwd})`);}

    // Pre-check cwd so we can give the LLM a clear ENOENT message instead of
    // a cryptic spawn error.
    if (cwd && !fs.existsSync(cwd)) {
      const msg = `Working directory does not exist: ${cwd}`;
      Logger.warn(`[CommandExecutor] ${msg}`);
      channel.appendLine(`  ✗ ${msg}`);
      return { output: msg, exitCode: 1 };
    }

    return new Promise<{ output: string; exitCode: number }>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(command, {
          cwd,
          shell: true,                        // let /bin/sh parse &&, ||, quotes, globs
          env: {
            ...process.env,
            FORCE_COLOR: "0",                 // suppress ANSI escapes in captured output
            NO_COLOR: "1",
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.error(`[CommandExecutor] spawn failed: ${msg}`);
        channel.appendLine(`  ✗ spawn failed: ${msg}`);
        resolve({ output: msg, exitCode: 1 });
        return;
      }

      this.activeChildren.add(child);

      const chunks: string[] = [];
      let collectedBytes = 0;
      let truncated = false;
      const collect = (data: Buffer): void => {
        const s = data.toString();
        // Always mirror live to the OutputChannel so the user sees progress…
        channel.append(s);
        // …but cap what we hand back to the LLM.
        if (truncated) {return;}
        const remaining = MAX_OUTPUT_BYTES - collectedBytes;
        if (s.length > remaining) {
          chunks.push(s.slice(0, remaining));
          chunks.push("\n…[output truncated]…\n");
          truncated = true;
        } else {
          chunks.push(s);
          collectedBytes += s.length;
        }
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);

      let settled = false;
      const settle = (output: string, exitCode: number): void => {
        if (settled) {return;}
        settled = true;
        clearTimeout(timer);
        this.activeChildren.delete(child);
        channel.appendLine(`  → exit ${exitCode}`);
        resolve({ output, exitCode });
      };

      const timer = setTimeout(() => {
        Logger.warn(`[CommandExecutor] Command timed out (${this.timeoutMs}ms): ${command}`);
        channel.appendLine(`  ✗ timed out after ${this.timeoutMs}ms — killing`);
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
        // Escalate to SIGKILL if it doesn't go down quietly.
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already dead */ }
        }, KILL_GRACE_MS);
        // 'close' will still fire after kill — settlement happens there.
      }, this.timeoutMs);

      child.on("error", (err) => {
        Logger.error(`[CommandExecutor] child error: ${err.message}`);
        settle(`spawn error: ${err.message}`, 1);
      });

      child.on("close", (code, signal) => {
        // 124 == GNU `timeout`'s convention; stable signal for the LLM to recognise.
        const exitCode = code ?? (signal ? 124 : 1);
        settle(chunks.join(""), exitCode);
      });
    });
  }

  private getOrCreateChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("NeuroCode Scaffold");
      this.outputChannel.show(true); // preserveFocus: true → visible but doesn't steal focus
    }
    return this.outputChannel;
  }

  dispose(): void {
    for (const child of this.activeChildren) {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }
    this.activeChildren.clear();
    this.outputChannel?.dispose();
    this.outputChannel = undefined;
  }
}