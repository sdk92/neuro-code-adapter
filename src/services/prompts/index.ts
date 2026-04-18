/**
 * Public surface of the prompts subsystem.
 *
 * Importers should only use this barrel file, not reach into individual files:
 *   import { PromptBuilder, PromptTemplateStore } from "@services/prompts";
 *
 * This keeps the module boundary explicit and allows internal refactors
 * (e.g. swapping the Markdown templates for YAML) without ripple.
 */
export { PromptTemplate } from "./PromptTemplate";
export type { PromptTemplateMetadata, TemplateVars } from "./PromptTemplate";
export { PromptTemplateStore } from "./PromptTemplateStore";
export {
  PromptBuilder,
  PromptDraft,
} from "./PromptBuilder";
export type { BuildReceipt, BuildResult } from "./PromptBuilder";
