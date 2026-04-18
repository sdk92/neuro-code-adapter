/**
 * PromptTemplateStore — Loads and caches prompt templates from disk.
 *
 * Lifecycle:
 *   1. Constructed with an absolute path to the resources/prompts/ directory
 *      (resolved from context.extensionUri at activation time).
 *   2. load() reads manifest.json and every referenced .md file in parallel.
 *   3. After load(), get(id) returns the PromptTemplate synchronously.
 *
 * Why load-once-at-activation:
 *   Activation already does filesystem work (reading package.json config,
 *   restoring globalState). Reading ~10 small prompt files adds <10ms on
 *   typical hardware. In return, every subsequent LLM call is synchronous
 *   w.r.t. prompt assembly — no I/O in the hot path.
 *
 * Why expose getManifestVersion() and per-template version:
 *   When the evaluation harness logs "this adaptation used template X v1.2.3",
 *   the version must be queryable from the running extension. Without this,
 *   cross-run comparisons in the Evaluation chapter are meaningless.
 *
 * Dev-mode hot reload (optional, behind NEUROCODE_PROMPT_HOTRELOAD env var):
 *   Calls fs.watch on the prompts directory and reloads on change. Disabled
 *   in production to avoid the fs.watch overhead on startup.
 */
import * as fs from "fs";
import * as path from "path";
import { PromptTemplate, type PromptTemplateMetadata } from "./PromptTemplate";
import { Logger } from "@shared/logger";

// ─── Manifest schema ─────────────────────────────────────────────────────────

interface TemplateManifestEntry {
  path: string;
  version: string;
  description?: string;
  requiredVars?: string[];
}

interface TemplateManifest {
  manifestVersion: string;
  description?: string;
  templates: Record<string, TemplateManifestEntry>;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class PromptTemplateStore {
  private templates = new Map<string, PromptTemplate>();
  private manifestVersion = "unloaded";
  private loaded = false;
  private watcher?: fs.FSWatcher;

  constructor(private readonly promptsDir: string) {}

  /**
   * Load the manifest and all referenced templates.
   * Safe to call multiple times; subsequent calls are no-ops unless forceReload=true.
   */
  async load(forceReload = false): Promise<void> {
    if (this.loaded && !forceReload) { return; }

    const manifestPath = path.join(this.promptsDir, "manifest.json");

    let manifestRaw: string;
    try {
      manifestRaw = await fs.promises.readFile(manifestPath, "utf-8");
    } catch (err) {
      throw new Error(
        `PromptTemplateStore: failed to read manifest at ${manifestPath}. ` +
        `Ensure resources/prompts/ is bundled with the extension. ` +
        `Underlying: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let manifest: TemplateManifest;
    try {
      manifest = JSON.parse(manifestRaw) as TemplateManifest;
    } catch (err) {
      throw new Error(
        `PromptTemplateStore: manifest.json is not valid JSON. ` +
        `Underlying: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Load every template file in parallel — small files, easy win.
    const entries = Object.entries(manifest.templates);
    const loaded = await Promise.all(
      entries.map(async ([id, spec]) => {
        const fullPath = path.join(this.promptsDir, spec.path);
        const body = await fs.promises.readFile(fullPath, "utf-8");
        const metadata: PromptTemplateMetadata = {
          id,
          version: spec.version,
          description: spec.description,
          requiredVars: spec.requiredVars ?? [],
        };
        // Trim trailing newline from file but preserve internal whitespace.
        return new PromptTemplate(metadata, body.replace(/\s+$/, ""));
      }),
    );

    this.templates.clear();
    for (const tpl of loaded) {
      this.templates.set(tpl.id, tpl);
    }
    this.manifestVersion = manifest.manifestVersion;
    this.loaded = true;

    Logger.log(
      `PromptTemplateStore: loaded ${this.templates.size} templates ` +
      `(manifest v${this.manifestVersion})`,
    );

    if (process.env.NEUROCODE_PROMPT_HOTRELOAD === "1" && !this.watcher) {
      this.enableHotReload();
    }
  }

  /**
   * Retrieve a template by ID. Throws if not loaded or if ID unknown.
   */
  get(id: string): PromptTemplate {
    this.assertLoaded();
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(
        `PromptTemplateStore: unknown template "${id}". ` +
        `Known templates: [${[...this.templates.keys()].sort().join(", ")}]`,
      );
    }
    return template;
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  getIds(): string[] {
    return [...this.templates.keys()].sort();
  }

  /** For telemetry: identify which manifest version produced a given output. */
  getManifestVersion(): string {
    return this.manifestVersion;
  }

  // ─── Dev-mode hot reload ──────────────────────────────────────────────────

  private enableHotReload(): void {
    try {
      this.watcher = fs.watch(
        this.promptsDir,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename) { return; }
          Logger.log(`PromptTemplateStore: detected change in ${filename}, reloading...`);
          this.load(true).catch((err) => {
            Logger.error("PromptTemplateStore: hot reload failed:", err);
          });
        },
      );
      Logger.log("PromptTemplateStore: hot reload enabled");
    } catch (err) {
      Logger.warn(`PromptTemplateStore: could not enable hot reload: ${err}`);
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.templates.clear();
    this.loaded = false;
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error(
        "PromptTemplateStore: not loaded. Call load() during extension activation " +
        "before any subsystem tries to retrieve a template.",
      );
    }
  }
}
