/**
 * Logger utility for NeuroCode Adapter.
 * Provides consistent logging across all modules.
 * 
 * Design pattern borrowed from Cline's Logger singleton,
 * simplified for our use case.
 */
import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export class Logger {
  static initialize(channel: vscode.OutputChannel): void {
    outputChannel = channel;
  }

  static log(message: string, ...args: unknown[]): void {
    const formatted = Logger.format("INFO", message, args);
    outputChannel?.appendLine(formatted);
  }

  static warn(message: string, ...args: unknown[]): void {
    const formatted = Logger.format("WARN", message, args);
    outputChannel?.appendLine(formatted);
  }

  static error(message: string, ...args: unknown[]): void {
    const formatted = Logger.format("ERROR", message, args);
    outputChannel?.appendLine(formatted);
    console.error(`[NeuroCode] ${message}`, ...args);
  }

  static debug(message: string, ...args: unknown[]): void {
    const formatted = Logger.format("DEBUG", message, args);
    outputChannel?.appendLine(formatted);
  }

  private static format(level: string, message: string, args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const extra = args.length > 0
      ? " " + args.map(a => (a instanceof Error ? a.message : String(a))).join(" ")
      : "";
    return `[${timestamp}] [${level}] ${message}${extra}`;
  }
}
