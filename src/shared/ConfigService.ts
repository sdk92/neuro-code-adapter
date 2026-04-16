/**
 * ConfigService — Centralized configuration management.
 *
 * Problem solved: API key was manually propagated to 3 subsystems in
 * NeurocodeController constructor AND onDidChangeConfiguration handler.
 * Adding a new subsystem that needs the key was error-prone.
 *
 * Now subsystems subscribe to config changes and receive updates automatically.
 */
import * as vscode from "vscode";
import { Logger } from "./logger";

// ─── Config snapshot ─────────────────────────────────────────────────────────

export interface NeurocodeConfig {
  // LLM provider settings
  llmProvider: "anthropic" | "openai";
  llmModel: string;
  llmBaseUrl: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  // Profile & UI settings
  neurodiversityProfile: string;
  fontSize: number;
  fontFamily: string;
  lineSpacing: number;
  colorScheme: string;
  focusMode: boolean;
  textToSpeech: boolean;
  taskGranularity: "combined" | "standard" | "detailed";
}

type ConfigChangeCallback = (config: NeurocodeConfig, changed: Set<string>) => void;

// ─── Service ─────────────────────────────────────────────────────────────────

export class ConfigService implements vscode.Disposable {
  private current: NeurocodeConfig;
  private callbacks: ConfigChangeCallback[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.current = ConfigService.readFromVscode();

    // Watch for VS Code settings changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("neurocode")) {
          const prev = this.current;
          this.current = ConfigService.readFromVscode();
          const changed = ConfigService.diffKeys(prev, this.current);
          if (changed.size > 0) {
            this.notifyAll(changed);
          }
        }
      })
    );
  }

  /**
   * Get current config snapshot.
   */
  getConfig(): Readonly<NeurocodeConfig> {
    return this.current;
  }

  /**
   * Get the active API key based on the current provider type.
   */
  get activeApiKey(): string {
    return this.current.llmProvider === "openai"
      ? this.current.openaiApiKey
      : this.current.anthropicApiKey;
  }

  /**
   * Subscribe to config changes.
   * Callback receives the new config and the set of changed keys.
   */
  onChange(callback: ConfigChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Read current config from VS Code settings.
   */
  private static readFromVscode(): NeurocodeConfig {
    const c = vscode.workspace.getConfiguration("neurocode");
    return {
      llmProvider: c.get<string>("llmProvider", "anthropic") as NeurocodeConfig["llmProvider"],
      llmModel: c.get<string>("llmModel", ""),
      llmBaseUrl: c.get<string>("llmBaseUrl", ""),
      anthropicApiKey: c.get<string>("anthropicApiKey", ""),
      openaiApiKey: c.get<string>("openaiApiKey", ""),
      neurodiversityProfile: c.get<string>("neurodiversityProfile", "neurotypical"),
      fontSize: c.get<number>("fontSize", 14),
      fontFamily: c.get<string>("fontFamily", "default"),
      lineSpacing: c.get<number>("lineSpacing", 1.5),
      colorScheme: c.get<string>("colorScheme", "default"),
      focusMode: c.get<boolean>("focusMode", false),
      textToSpeech: c.get<boolean>("textToSpeech", false),
      taskGranularity: c.get<string>("taskGranularity", "standard") as NeurocodeConfig["taskGranularity"],
    };
  }

  /**
   * Diff two config objects and return the set of changed keys.
   */
  private static diffKeys(a: NeurocodeConfig, b: NeurocodeConfig): Set<string> {
    const changed = new Set<string>();
    for (const key of Object.keys(a) as Array<keyof NeurocodeConfig>) {
      if (a[key] !== b[key]) {
        changed.add(key);
      }
    }
    return changed;
  }

  private notifyAll(changed: Set<string>): void {
    Logger.log(`Config changed: ${[...changed].join(", ")}`);
    for (const cb of this.callbacks) {
      try {
        cb(this.current, changed);
      } catch (e) {
        Logger.error("ConfigService callback error:", e);
      }
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.callbacks = [];
  }
}
