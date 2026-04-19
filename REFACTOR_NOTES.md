# NeuroCode Adapter — M1 + M2 + M4 + M5 Refactor

This tree contains the NeuroCode Adapter VS Code extension with four
completed refactor milestones applied:

- **M1 — Prompt externalisation + PromptBuilder pattern** (advisor-requested)
- **M2 — Zod-based schema validation** (single source of truth for types + runtime validation)
- **M4 — Expanded test suite** (95 new tests beyond M1+M2 baseline)
- **M5 — Architecture + thesis documentation**

(M3 — Evaluation telemetry — is deferred.)

## Status

- `npx tsc --noEmit` → **0 errors**
- `npx jest` → **165/165 passing across 9 test suites**
- `node esbuild.js --production` → **bundles cleanly** (1.1 MB minified)

## Test breakdown

| Suite | Tests | What it covers |
|---|---|---|
| `PromptTemplate` | 11 | Var substitution, strict-mode contracts, introspection |
| `PromptBuilder` | 14 | Fluent composition, receipts, error propagation |
| `PromptTemplateStore` | 7 | Real filesystem, manifest parsing, round-trip check |
| `AdaptationResponseSchema` | 17 | Zod coercion, fallback defaults, clamping |
| `MessageValidator` | 21 | Discriminated-union narrowing, deep pref validation |
| `ProfileRegistry` | 15 | Register/get/clear, prompt fragment composition |
| `strategies` | 13 | Base strategy lookup, pref overrides, immutability |
| `AdaptiveRenderer` | 17 | escapeHtml, markdownToHtml LaTeX protection |
| `parser` | 50 | Heuristic parsing, language detection, validateAndNormalise |
| **Total** | **165** | |

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

### M4 — Expanded tests
- `src/features/assignments/__tests__/parser.test.ts` — heuristic parsing pinned down
- `src/shared/__tests__/ProfileRegistry.test.ts` — registry contract tests
- `src/features/adaptive/__tests__/strategies.test.ts` — buildStrategy + immutability
- `src/features/adaptive/__tests__/AdaptiveRenderer.test.ts` — helpers + LaTeX protection

### M5 — Documentation
- `README.md` (project root) — quickstart, directory map, configuration
- `docs/architecture.md` — component diagram, activation sequence, adaptation sequence, fallback flow, scaffold loop (all Mermaid UML)
- `docs/prompts.md` — PromptTemplate/Builder design rationale for thesis Design chapter
- `docs/extending.md` — recipes for adding profiles/providers/tools/messages

### Test infrastructure
- `tsconfig.test.json` — new file, adds `jest` types for test compilation
- `jest.config.js` — points `ts-jest` at the test tsconfig

## Build and test

```bash
npm install                                  # installs zod 4 plus pre-existing deps
npx tsc --noEmit                             # type check
npx jest                                     # runs 165 tests across 9 suites
node esbuild.js                              # dev bundle
node esbuild.js --production                 # prod bundle
```

## Package as .vsix

```bash
npm install -g @vscode/vsce
vsce package
```

`resources/prompts/` is automatically bundled into the `.vsix` — no extra config needed.

## Development

### Hot-reload of prompt templates (dev-only)

```bash
NEUROCODE_PROMPT_HOTRELOAD=1 code --extensionDevelopmentPath=$PWD
```

`PromptTemplateStore` watches `resources/prompts/` and reloads on change.

## Thesis docs

The `docs/` directory is written to serve as a direct reference for the
thesis Design chapter:

- `docs/architecture.md` — system design with Mermaid UML diagrams
  (component, activation sequence, adaptation flow, fallback behaviour,
  scaffold loop)
- `docs/prompts.md` — rationale for the Builder pattern, template
  externalisation, and receipt-based provenance
- `docs/extending.md` — recipes that make the "extensibility" claim
  concrete (each recipe is 2-4 lines of code)

Historical diffs documenting the M1/M2 migrations:

- `docs/CONTROLLER_DIFF.md` — M1 controller constructor patch
- `docs/VALIDATOR_PATCHES.md` — M2 validator migration patch

## What's next

- **M3** (Evaluation telemetry) — log `BuildReceipt` + adaptation strategy to
  `context.globalState`, produce CSV for the Evaluation chapter

Plus the optional R1–R4 items (AdaptiveRenderer decomposition, KaTeX local
bundling + CSP, provider/MCP config UI, ScaffoldEngine abort signal).
See the advisor's notes from 10 April for priority order.
