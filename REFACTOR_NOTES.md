# NeuroCode Adapter — M1 + M2 Refactor

This tree contains the NeuroCode Adapter VS Code extension with two
completed refactor milestones applied:

- **M1 — Prompt externalisation + PromptBuilder pattern** (advisor-requested)
- **M2 — Zod-based schema validation** (single source of truth for types + runtime validation)

## Status

- `npx tsc --noEmit` → **0 errors**
- `npx jest src/services/prompts src/shared` → **69/69 passing**
- `node esbuild.js` → **bundles cleanly** (1.9 MB extension.js produced)

## What changed from the original

### M1 — Prompt externalisation
- `resources/prompts/` — new directory with `manifest.json` + `.md` templates
- `src/services/prompts/` — new module (`PromptTemplate`, `PromptTemplateStore`, `PromptBuilder`)
- `src/services/llm/AdaptationEngine.ts` — hardcoded system/user prompts removed, now uses `PromptBuilder`
- `src/features/assignments/parser.ts` — PDF structuring prompt moved to templates
- `src/features/assignments/AssignmentManager.ts` — forwards `PromptBuilder` to parser
- `src/extension.ts` — loads `PromptTemplateStore` during activation
- `src/core/controller/NeurocodeController.ts` — constructor takes `PromptBuilder`, wires it to subsystems

### M2 — Schema-driven validation
- `src/shared/schemas/` — new module with 6 files: primitives, preferences, assignment, adaptation, webview-messages, barrel
- `src/shared/types.ts` — now re-exports Zod-inferred types (backward compatible)
- `src/shared/messages.ts` — `WebviewMessage` re-exported from schemas
- `src/shared/MessageValidator.ts` — ~150 lines → ~60 lines, `as unknown as` cast gone
- `src/services/llm/AdaptationEngine.ts` — `validateAdaptationResponse` now Zod-backed
- `src/features/assignments/parser.ts` — `validateAndNormalise` now Zod-backed
- `src/features/preferences/PreferenceManager.ts` — `updatePreferences` accepts `PartialUserPreferences` (deep-partial)

### Test infrastructure
- `tsconfig.test.json` — new file, adds `jest` types for test compilation
- `jest.config.js` — points `ts-jest` at the test tsconfig

## Build and test

```bash
npm install                                  # installs zod 4 plus pre-existing deps
npx tsc --noEmit                             # type check
npx jest src/services/prompts src/shared     # runs 69 tests
node esbuild.js                              # dev bundle
node esbuild.js --production                 # prod bundle
```

## Package as .vsix

```bash
npm install -g @vscode/vsce
vsce package
```

`resources/prompts/` is automatically bundled into the `.vsix` — no extra config needed.

## Optional features

### Hot-reload of prompt templates (dev-only)

```bash
NEUROCODE_PROMPT_HOTRELOAD=1 code --extensionDevelopmentPath=$PWD
```

`PromptTemplateStore` watches `resources/prompts/` and reloads on change.

## Thesis docs

Two explanatory documents for the thesis Design chapter:

- `docs/CONTROLLER_DIFF.md` — (already applied) 3-step diff for the Controller
- `docs/VALIDATOR_PATCHES.md` — (already applied) 2-step patch for old validators

These document the thinking behind each refactor decision, useful as references
when writing up the Design chapter.

## What's next

- **M3** (Evaluation telemetry) — log `BuildReceipt` + adaptation strategy to
  `context.globalState`, produce CSV for the Evaluation chapter
- **M4** (Focused test expansion) — heuristic parser tests, profile registry tests
- **M5** (README + architecture UML) — thesis-ready repo presentation

Plus the optional R1–R4 items (AdaptiveRenderer decomposition, KaTeX local
bundling + CSP, provider/MCP config UI, ScaffoldEngine abort signal).

See the advisor's notes from 10 April for priority order.
