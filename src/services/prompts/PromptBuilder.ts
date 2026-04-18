/**
 * PromptBuilder — Fluent composition of prompts from templates + fragments.
 *
 * This is the Builder pattern in the sense the advisor described during the
 * 10-April meeting: the caller (AdaptationEngine, parser.ts) does NOT know how
 * to combine a base template with granularity / requestType / profile fragments.
 * It hands a configuration to the builder and asks for the finished product.
 *
 * Contrast with the old approach:
 *   OLD: AdaptationEngine.buildAdaptationPrompt() had nested if/else across
 *        granularity (3 values) × requestType (2 values) = 6 branches, all
 *        concatenating strings with `prompt += "..."`. To add a new axis
 *        (e.g. rubric-driven adaptation) you edit this function AND all the
 *        hardcoded strings.
 *
 *   NEW: AdaptationEngine constructs a PromptDraft, chains .withFragment()
 *        per axis, and calls .build(). Adding a new axis = add a new fragment
 *        template to resources/prompts/ + one .withFragment() call. No change
 *        to the engine's assembly logic.
 *
 * Record-and-replay for evaluation:
 *   build() returns both the final string AND a BuildReceipt listing every
 *   template ID + version that contributed. Telemetry logs this receipt so
 *   the Evaluation chapter can attribute performance to specific prompt
 *   configurations, and so answer questions like "does detailed granularity
 *   improve completion rate?".
 */
import type { PromptTemplateStore } from "./PromptTemplateStore";
import type { TemplateVars } from "./PromptTemplate";

/**
 * Full record of which templates produced a prompt.
 * Attach to AdaptationResponse telemetry for reproducibility.
 */
export interface BuildReceipt {
  manifestVersion: string;
  templates: Array<{ id: string; version: string }>;
}

export interface BuildResult {
  text: string;
  receipt: BuildReceipt;
}

/**
 * A draft prompt under construction. Created by PromptBuilder.from().
 * Immutable-ish: each `with*` method returns `this` for chaining, but the
 * draft should not be reused after build() is called.
 */
export class PromptDraft {
  private readonly parts: string[] = [];
  private readonly contributingTemplates: Array<{ id: string; version: string }> = [];
  private separator = "\n\n";

  constructor(
    private readonly store: PromptTemplateStore,
    baseTemplateId: string,
    private readonly baseVars: TemplateVars,
  ) {
    const base = store.get(baseTemplateId);
    this.parts.push(base.render(baseVars));
    this.contributingTemplates.push({ id: base.id, version: base.version });
  }

  /**
   * Append a fragment template. Fragment inherits the draft's base vars,
   * optionally extended with fragment-specific vars.
   *
   * @throws Error if templateId is not found in the store.
   */
  withFragment(templateId: string, extraVars: TemplateVars = {}): this {
    const template = this.store.get(templateId);
    const mergedVars = { ...this.baseVars, ...extraVars };
    this.parts.push(template.render(mergedVars));
    this.contributingTemplates.push({ id: template.id, version: template.version });
    return this;
  }

  /**
   * Append a fragment only if it exists in the store. Silent no-op if missing.
   * Useful for optional axes (e.g. rubric fragment that may or may not be defined).
   */
  withOptionalFragment(templateId: string, extraVars: TemplateVars = {}): this {
    if (this.store.has(templateId)) {
      this.withFragment(templateId, extraVars);
    }
    return this;
  }

  /**
   * Append raw text. Use sparingly — the whole point of the template system
   * is to keep prompt content out of code. Legitimate uses:
   *   - Injecting dynamically-generated content that has no template (e.g.
   *     ProfileRegistry's per-profile fragments built from registered profiles).
   *   - Debug markers.
   */
  withRawText(text: string, attribution?: { id: string; version: string }): this {
    this.parts.push(text);
    if (attribution) {
      this.contributingTemplates.push(attribution);
    }
    return this;
  }

  /** Override the default "\n\n" join separator. */
  withSeparator(sep: string): this {
    this.separator = sep;
    return this;
  }

  /**
   * Produce the final prompt string and a receipt for telemetry.
   */
  build(): BuildResult {
    return {
      text: this.parts.join(this.separator),
      receipt: {
        manifestVersion: this.store.getManifestVersion(),
        templates: [...this.contributingTemplates],
      },
    };
  }

  /** Convenience: build() and throw away the receipt. */
  buildText(): string {
    return this.build().text;
  }
}

/**
 * PromptBuilder — entry point. Thin wrapper over PromptTemplateStore that
 * returns a PromptDraft for fluent composition.
 *
 * Usage:
 *   const draft = promptBuilder
 *     .from("adaptation.user", vars)
 *     .withFragment(`adaptation.fragment.granularity.${granularity}`)
 *     .withFragment(`adaptation.fragment.request.${requestType}`);
 *   const { text, receipt } = draft.build();
 */
export class PromptBuilder {
  constructor(private readonly store: PromptTemplateStore) {}

  /** Start a new draft with the given base template. */
  from(baseTemplateId: string, vars: TemplateVars = {}): PromptDraft {
    return new PromptDraft(this.store, baseTemplateId, vars);
  }

  /** Access the underlying store (for telemetry / diagnostics). */
  get templateStore(): PromptTemplateStore {
    return this.store;
  }
}
