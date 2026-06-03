---
name: add-prompt-template
description: Add a new prompt template or fragment to resources/prompts/. Use when the user asks to "add a prompt for X", introduce a new LLM-driven feature (e.g. summarisation, hint generation), or split an existing prompt into reusable fragments. Keeps the manifest, .md files, and PromptBuilder call sites in sync.
---

# Add a prompt template or fragment

Prompts in NeuroCode Adapter live in `resources/prompts/` and are loaded by `PromptTemplateStore` at activation. Every template is registered in `resources/prompts/manifest.json` with an ID, a version, and the list of variables it expects. `PromptBuilder` composes the final prompt and returns a `BuildReceipt` for telemetry — so template IDs and versions are load-bearing.

## Ask first

Before adding anything, confirm with the user:

1. **Is this a system prompt, a user prompt, or a fragment?** — system/user are full templates; fragments are conditional inserts (e.g. granularity, request-type).
2. **Template ID** — usually `<feature>.<role>`, e.g. `summarisation.system`, `hint.user`. For fragments: `<feature>/fragments/<name>`.
3. **What variables does it need?** — list every `{{var}}` placeholder. These must be declared in the manifest or the builder will reject the template.
4. **What call site composes it?** — which service file will call `PromptBuilder.from("<id>", vars)`?

## The change

### 1. Create the `.md` file

Place it under `resources/prompts/<feature>/<role>.md` (or `.../fragments/<name>.md` for fragments). Use `{{variableName}}` for placeholders. Keep the body in imperative voice and avoid embedding feature flags — fragments exist precisely so the call site can pick variants.

### 2. Register it in `resources/prompts/manifest.json`

Add a new entry:

```json
{
  "id": "<feature>.<role>",
  "path": "<feature>/<role>.md",
  "version": "1.0.0",
  "variables": ["var1", "var2"],
  "description": "<one line>"
}
```

The `variables` array MUST include every `{{var}}` in the body and exclude any not used. `PromptTemplateStore.test.ts` rejects manifest drift on load — if the test fails after your change, the cause is almost always an undeclared or unused variable.

### 3. Call it from the right service

The expected pattern in services like `AdaptationEngine`, `AssignmentManager`, or `ScaffoldEngine`:

```ts
const draft = this.promptBuilder
  .from("<feature>.system")
  .withRawText(profileFragment)         // optional, profile-specific
  .build();

const userDraft = this.promptBuilder
  .from("<feature>.user", { var1, var2 })
  .withFragment(granularityFragmentId)  // optional
  .build();
```

The returned `BuildReceipt` should be passed through to whatever the engine returns, so the strategy chain can attribute outputs to specific template versions.

### 4. (Fragments only) — make sure it's actually used

Fragments that no `PromptBuilder.withFragment(...)` call site references are dead weight. Search:

```bash
grep -r "withFragment.*<your-fragment-id>" src/
```

If there are no matches, either the call site is missing or the fragment is unnecessary.

## Verify

```bash
npx jest src/services/prompts/__tests__/PromptTemplateStore.test.ts
npx jest src/services/prompts/__tests__/PromptBuilder.test.ts
npx tsc --noEmit
```

`PromptTemplateStore.test.ts` round-trips the manifest against the file system — it will catch missing files, missing manifest entries, and variable drift.

## Version bumps

If you're **editing** an existing template (not adding a new one), bump the `version` field in `manifest.json`. The version flows through `BuildReceipt` into evaluation telemetry — failing to bump means the new output is indistinguishable from the old in any A/B analysis.

## What NOT to do

- Don't inline prompt text in `.ts` files. That's exactly what the M1 refactor was about — everything LLM-facing lives under `resources/prompts/`.
- Don't add provider-specific prompts. Templates are provider-agnostic; mapping happens inside the `LlmProvider` implementation.
- Don't fork an existing template by copy-paste. Pull the shared content into a fragment and compose both variants from it.

## Reference

`docs/prompts.md` documents the PromptBuilder design rationale in detail, including the receipt contract.
