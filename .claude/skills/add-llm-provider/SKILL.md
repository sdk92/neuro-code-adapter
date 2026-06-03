---
name: add-llm-provider
description: Add a new LLM provider (e.g. Gemini, Cohere, Bedrock) to NeuroCode Adapter. Use when the user asks to "support <X>", "add a provider", or names an LLM service not in the current LlmProviderType union. Coordinates the six-file change across the LlmProvider interface, ProviderFactory, config schema, settings UI, and controller key-resolution.
---

# Add an LLM provider

The codebase uses a Factory pattern for provider instantiation. Adding a provider is straightforward but touches six locations — the goal is to keep the type union, factory switch, config surface, and UI in lockstep.

## Ask first

Before writing code, ask the user for:

1. **Provider name** (display string, e.g. `"Google Gemini"`)
2. **Slug** (lowercase, used in config enum, e.g. `gemini`)
3. **Default model ID** (e.g. `gemini-2.5-pro`)
4. **Document input support** — does this provider accept PDFs directly? (`supportsDocumentInput`)
5. **SDK or REST?** — if SDK, the package name and whether to add it as a dependency; if REST, you'll write a fetch wrapper.

If they only named the provider, ask for the rest. Do not invent model IDs.

## The six-file change

### 1. Implement the interface — `src/services/llm/<Name>Provider.ts`

Create a new class implementing `LlmProvider` (`src/services/llm/LlmProvider.ts`). The interface requires:

- `readonly name: string`
- `readonly supportsDocumentInput: boolean`
- `complete(params: LlmCompletionParams): Promise<LlmTextResponse>`
- `completeWithTools(params: LlmToolCompletionParams): Promise<LlmToolResponse>`
- `dispose(): void`

Map the shared `LlmMessage` shape to/from the provider's native format. Mirror the structure of `AnthropicProvider.ts` or `OpenAiProvider.ts` — pick the closer analogue.

### 2. Extend the provider type union — `src/services/llm/LlmProvider.ts`

Add the slug to `LlmProviderType`. This is the type that propagates through `ConfigService`, `ProviderFactory`, and the controller.

### 3. Wire the factory — `src/services/llm/ProviderFactory.ts`

- Add the slug → default model entry in `DEFAULT_MODELS`
- Add a `case "<slug>": return new <Name>Provider(...)` to the switch in `createProvider`

### 4. Extend the config schema — `src/shared/ConfigService.ts`

- Add `<slug>ApiKey: string` to `NeurocodeConfig`
- Read it in `readFromVscode()`: `<slug>ApiKey: c.get<string>("<slug>ApiKey", "")`
- Update the `llmProvider` field's literal union if it's typed inline

### 5. Surface in `package.json`

- Add the slug to `contributes.configuration.neurocode.llmProvider.enum` (with a matching `enumDescriptions` entry)
- Add `neurocode.<slug>ApiKey` as a new string config property

### 6. Update key resolution — `src/core/controller/NeurocodeController.ts`

In `rebuildProvider()`, extend the conditional that picks the API key based on `config.llmProvider`. Match the existing chain style.

## Verify

```bash
npx tsc --noEmit
npx jest src/services/llm
```

Add a stub test at `src/services/llm/__tests__/<Name>Provider.test.ts` that constructs the provider with a fake key and verifies `name`, `model`, and `supportsDocumentInput`. Full integration tests should mock the network — never make real API calls from Jest.

## What NOT to do

- Don't bypass `ProviderFactory` from consumer code. `AdaptationEngine`, `ScaffoldEngine`, and `AssignmentManager` all receive a provider via `setProvider()` — they must never instantiate one directly.
- Don't hardcode the API key from `process.env` in the provider class. Keys flow through `ConfigService` → controller → factory → constructor.
- Don't add provider-specific branches to `AdaptationEngine` or `ScaffoldEngine`. If the provider's native format differs (e.g. tool calling shape), do the mapping inside the `*Provider` class so the rest of the system sees a uniform `LlmToolResponse`.

## Reference

`docs/extending.md` has a worked Gemini example with all six steps written out.
