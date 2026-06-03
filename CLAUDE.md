# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type check (no emit)
npx tsc --noEmit

# Run all tests
npx jest

# Run a subset of tests
npx jest src/services/prompts      # by directory
npx jest PromptBuilder             # by filename fragment
npx jest -t "granularity"          # by test-name pattern

# Dev build
node esbuild.js

# Production build (minified, tree-shaken)
node esbuild.js --production

# Lint
npx eslint src --ext ts

# Package as .vsix (requires @vscode/vsce installed globally)
vsce package
```

Tests live in `src/**/__tests__/*.test.ts` and use Jest + ts-jest. They run in Node (no VS Code instance needed). The test tsconfig is `tsconfig.test.json` (adds `jest` types on top of the main config).

## Architecture

The codebase is a VS Code extension with four layers. Dependencies point strictly downward: `core → features → services → shared`. All domain types are `z.infer`-ed from Zod schemas in `src/shared/schemas/` — never define hand-rolled interfaces for domain objects.

```
extension.ts            VS Code lifecycle entry; wires everything in activation order
core/
  NeurocodeController   Central orchestrator — owns all subsystems, routes webview messages
  WebviewManager        Sidebar panel lifecycle; buffers messages until webview resolves
features/
  AdaptiveRenderer      Pure (Assignment, Prefs, AdaptationResponse?) → HTML transform
  AssignmentManager     PDF import (two-tier parser), per-assignment progress in globalState
  PreferenceManager     Load/save/broadcast user preferences; fires onPreferencesChanged
  ScaffoldEngine        Agentic tool-use loop (LLM calls tools until end_turn)
services/
  AdaptationEngine      Three-strategy fallback: MCP → LLM provider → rule-based
  PromptTemplateStore   Reads resources/prompts/ manifest + .md files; hot-reloadable
  PromptBuilder         Composes system/user prompts from templates + fragments; returns BuildReceipt
  LlmProvider (iface)   Implemented by AnthropicProvider and OpenAiProvider; factory in ProviderFactory
  McpManager            MCP client for optional external adaptation tools
shared/
  schemas/              Zod schemas — single source of truth for all types
  ProfileRegistry       NeurodiversityType → NeurodiversityModule map (registry pattern)
  MessageValidator      Validates inbound webview messages via Zod discriminated union
  ConfigService         Reads/watches neurocode.* VS Code settings
```

### Key design patterns

- **Registry** — `ProfileRegistry`, `SectionRendererRegistry`, `ScaffoldToolRegistry`: add a new entry with one `register()` call; consumers pick it up automatically.
- **Strategy chain** — `AdaptationEngine.generateAdaptation` tries MCP → direct provider → rule-based; each path records `strategy` on the result for telemetry.
- **Builder** — `PromptBuilder` / `PromptDraft` compose prompts from fragments without if/else chains; returns a `BuildReceipt` for template version attribution.
- **Zod as single source of truth** — `src/shared/schemas/` defines all schemas; `src/shared/types.ts` re-exports `z.infer<>` types as the public type surface.

### PDF parsing (two-tier)

`features/assignments/parser.ts` tries Tier 1 (base64 PDF → LLM with `pdf-structuring` prompt template) when the provider supports document input (`supportsDocumentInput = true`). On failure or when no provider is configured, it falls back to Tier 2: `pdf-parse` text extraction + `structureViaHeuristics` (heading/numbered/labelled splits). Both paths validate output via `AssignmentSchema.safeParse`.

### Webview message protocol

Inbound (webview → extension): defined in `src/shared/schemas/webview-messages.ts` as a Zod discriminated union; validated by `MessageValidator` before reaching `NeurocodeController`. To add a new message type, add it to the union — validation is automatic.

Outbound (extension → webview): typed union in `src/shared/messages.ts` (no Zod validation — extension is trusted).

### Prompt templates

All LLM prompts live in `resources/prompts/` with a `manifest.json` that declares template IDs, versions, and required variables. Templates are loaded at activation by `PromptTemplateStore`. Set `NEUROCODE_PROMPT_HOTRELOAD=1` to reload on file change without recompiling.

## Extending the codebase

- **New neurodiversity profile**: add module + `register()` in `builtinProfiles.ts`, extend `BuiltInNeurodiversityTypes` enum in `src/shared/schemas/primitives.ts`, update `package.json` enum + preferences HTML. See `docs/extending.md`.
- **New LLM provider**: implement `LlmProvider` interface, add a `case` in `ProviderFactory`, extend `LlmProviderType`. See `docs/extending.md`.
- **New scaffold tool**: implement `NeurocodeToolDef`, register in `src/features/scaffold/tools/index.ts`. See `docs/extending.md`.
- **New prompt template/fragment**: add `.md` file + entry in `resources/prompts/manifest.json`. See `docs/prompts.md`.

## Path aliases (tsconfig + jest)

| Alias | Resolves to |
|---|---|
| `@core/` | `src/core/` |
| `@features/` | `src/features/` |
| `@services/` | `src/services/` |
| `@shared/` | `src/shared/` |
