/**
 * ProviderFactory — Creates LlmProvider instances from configuration.
 *
 * Centralises provider instantiation so that callers (AdaptationEngine,
 * AssignmentManager, ScaffoldEngine) never import concrete provider classes.
 *
 * Adding a new provider:
 *   1. Implement LlmProvider interface (e.g. GeminiProvider.ts)
 *   2. Add a case to the switch in createProvider()
 *   3. Add the type to LlmProviderType union in LlmProvider.ts
 *   4. Add config UI in package.json
 */
import type { LlmProvider, LlmProviderConfig } from "./LlmProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAiProvider } from "./OpenAiProvider";
import { Logger } from "@shared/logger";

/**
 * Default models per provider — used when no model is explicitly configured.
 */
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
};

/**
 * Create an LlmProvider from a configuration object.
 *
 * @throws Error if apiKey is missing or provider type is unknown.
 */
export function createProvider(config: LlmProviderConfig): LlmProvider {
  if (!config.apiKey) {
    throw new Error(
      `No API key configured for provider "${config.provider}". ` +
      `Set the appropriate key in VS Code settings.`
    );
  }

  const model = config.model || DEFAULT_MODELS[config.provider];
  if (!model) {
    throw new Error(
      `No model specified for provider "${config.provider}" and no default available.`
    );
  }

  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.apiKey, model);

    case "openai":
      return new OpenAiProvider(config.apiKey, model, config.baseUrl);

    default:
      throw new Error(
        `Unknown LLM provider: "${config.provider}". ` +
        `Supported providers: anthropic, openai`
      );
  }
}

/**
 * Attempt to create a provider, returning null on failure (e.g. missing key).
 * Logs the error instead of throwing.
 */
export function tryCreateProvider(config: LlmProviderConfig): LlmProvider | null {
  try {
    return createProvider(config);
  } catch (error) {
    Logger.warn(`Could not create LLM provider: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
