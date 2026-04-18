/**
 * PromptTemplate — A single prompt template loaded from disk.
 *
 * Responsibilities:
 *   1. Hold raw template text and metadata (id, version, required vars)
 *   2. Render by substituting {{var}} placeholders with provided values
 *   3. Enforce strict-mode variable contracts:
 *      - Missing required vars throw (prevents silent prompt corruption)
 *      - Unknown vars passed in are ignored (but logged in strict mode)
 *      - Undeclared placeholders found at render time throw
 *
 * Design rationale (for thesis Design chapter):
 *   Why a class instead of a plain function? Because each template has
 *   *identity* (id, version) that must travel with its rendered output
 *   for evaluation telemetry — "this adaptation was produced by
 *   adaptation.user@1.0.0 + granularity.combined@1.0.0". A function
 *   rendering over raw strings loses that provenance.
 *
 * Placeholder syntax:
 *   - {{variableName}}        basic substitution
 *   - {{ variableName }}      whitespace tolerant
 *   - Only matches \w+ (alphanumerics + underscore) — no nesting, no expressions
 *
 * Non-goals:
 *   - Full templating language (loops, conditionals, filters). Deliberately kept
 *     minimal: all logic lives in PromptBuilder via fragment composition, not in
 *     templates themselves. A template is dumb text with named holes.
 */

export interface PromptTemplateMetadata {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly requiredVars: readonly string[];
}

export type TemplateVars = Readonly<Record<string, string | number | boolean>>;

/** Matches {{ varName }} with optional surrounding whitespace. */
const PLACEHOLDER_REGEX = /\{\{\s*(\w+)\s*\}\}/g;

export class PromptTemplate {
  constructor(
    public readonly metadata: PromptTemplateMetadata,
    private readonly body: string,
  ) {}

  get id(): string { return this.metadata.id; }
  get version(): string { return this.metadata.version; }

  /** Returns the raw template body, unrendered. Exposed for debugging and tests. */
  get raw(): string { return this.body; }

  /**
   * Render the template with the given variables.
   *
   * @throws Error if any required variable (from manifest) is missing.
   * @throws Error if the template body references a variable not provided.
   */
  render(vars: TemplateVars = {}): string {
    // 1. Manifest-declared contract: every required var must be present.
    for (const requiredVar of this.metadata.requiredVars) {
      if (!(requiredVar in vars)) {
        throw new Error(
          `PromptTemplate "${this.id}": missing required variable "${requiredVar}". ` +
          `Provided: [${Object.keys(vars).join(", ") || "none"}]`,
        );
      }
    }

    // 2. Actual substitution — any {{var}} the template uses must resolve.
    return this.body.replace(PLACEHOLDER_REGEX, (_match, key: string) => {
      if (!(key in vars)) {
        throw new Error(
          `PromptTemplate "${this.id}": template references unknown variable "${key}". ` +
          `Declared required vars: [${this.metadata.requiredVars.join(", ") || "none"}]. ` +
          `Either add "${key}" to requiredVars in manifest.json, or remove the placeholder.`,
        );
      }
      return String(vars[key]);
    });
  }

  /**
   * Scan the body and return all placeholder names found.
   * Useful for tests: assert(template.declaredPlaceholders() === template.metadata.requiredVars).
   */
  declaredPlaceholders(): string[] {
    const seen = new Set<string>();
    for (const match of this.body.matchAll(PLACEHOLDER_REGEX)) {
      seen.add(match[1]);
    }
    return [...seen];
  }
}
