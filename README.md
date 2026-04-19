# NeuroCode Adapter

A VS Code extension that adapts programming assignments for neurodiverse learners
(dyslexia, ADHD, autism, and extensible profiles). Given a PDF assignment, it
produces an accessibility-tuned view — font, spacing, chunking, progressive
disclosure, simplified language, and optional AI-driven task breakdown — all
configured per student profile.

## Status

- **Build**: `npx tsc --noEmit` passes, 0 errors
- **Tests**: `npx jest` 165/165 passing across 9 suites
- **Bundle**: `node esbuild.js --production` produces a working extension bundle

## What's in this branch

Two completed refactor milestones on top of the base implementation:

- **M1 — Prompt externalisation + PromptBuilder pattern**
  All LLM prompts live in `resources/prompts/*.md` with a `manifest.json`.
  A `PromptBuilder` composes system and user prompts from the templates + fragments,
  returning a `BuildReceipt` so evaluation telemetry can attribute outputs to
  specific template versions.

- **M2 — Zod-based schema validation**
  Single source of truth for types and runtime validation. All domain types
  are `z.infer`-ed from Zod schemas in `src/shared/schemas/`. Hand-rolled
  validators replaced with `.safeParse()`.

Plus **M4** — expanded test suite (heuristic parser, profile registry,
strategy composition, renderer helpers).

See [docs/architecture.md](docs/architecture.md) for the system design
and [docs/prompts.md](docs/prompts.md) for the template/builder design.

## Quickstart

```bash
# Install dependencies (including zod 4)
npm install

# Type check
npx tsc --noEmit

# Run the test suite
npx jest

# Dev build
node esbuild.js

# Production build
node esbuild.js --production

# Run in a new VS Code window for development
# (Use the VS Code "Run Extension" debug config, or:)
code --extensionDevelopmentPath=$PWD
```

## Packaging as `.vsix`

```bash
npm install -g @vscode/vsce
vsce package
```

The `.vsix` will include everything in `resources/` (prompt templates,
sample PDFs) and the bundled extension code — no additional config needed.

## Directory layout

```
.
├── src/
│   ├── extension.ts              Entry point, bootstraps all subsystems
│   ├── core/
│   │   ├── controller/           NeurocodeController — central orchestrator
│   │   └── webview/              WebviewManager — sidebar panel
│   ├── features/
│   │   ├── adaptive/             Rendering pipeline, profile strategies
│   │   ├── assignments/          PDF parsing, progress tracking
│   │   ├── preferences/          User preferences, profile switching
│   │   └── scaffold/             Agentic project scaffolding
│   ├── services/
│   │   ├── llm/                  Provider abstraction, AdaptationEngine
│   │   ├── mcp/                  MCP client
│   │   └── prompts/              PromptTemplate, Store, Builder (M1)
│   └── shared/
│       ├── schemas/              Zod schemas — single source of truth (M2)
│       ├── types.ts              Re-exports z.infer types
│       ├── messages.ts           Extension ↔ webview message protocol
│       ├── MessageValidator.ts   Webview message validation (M2: Zod)
│       ├── ConfigService.ts      VS Code settings observer
│       ├── ProfileRegistry.ts    Neurodiversity module registry
│       └── logger.ts             Shared logger
├── resources/
│   ├── icon.svg
│   └── prompts/                  Externalised LLM prompts (M1)
│       ├── manifest.json         Template registry with versions
│       ├── adaptation/
│       │   ├── system.md
│       │   ├── user.md
│       │   └── fragments/        Granularity & request-type fragments
│       └── pdf-structuring/
│           ├── system.md
│           └── user.md
├── samples/                       PDF assignment fixtures for manual testing
├── docs/
│   ├── architecture.md           System design + Mermaid UML
│   ├── prompts.md                PromptBuilder design rationale
│   ├── extending.md              How to add profiles/providers/tools
│   ├── CONTROLLER_DIFF.md        History: M1 controller patch
│   └── VALIDATOR_PATCHES.md      History: M2 validator migration patch
├── esbuild.js
├── jest.config.js
├── tsconfig.json
├── tsconfig.test.json             Jest-specific config (adds 'jest' types)
└── package.json
```

## Configuration

All settings are under the `neurocode.*` namespace in VS Code settings
(`Settings → Extensions → NeuroCode Adapter`, or directly edit `settings.json`):

| Setting | Default | Description |
|---|---|---|
| `llmProvider` | `anthropic` | `anthropic` or `openai` (also handles Ollama / LM Studio / Azure via OpenAI-compatible endpoints) |
| `llmModel` | (empty) | Model ID; empty uses the provider default |
| `llmBaseUrl` | (empty) | Custom OpenAI-compatible endpoint URL |
| `anthropicApiKey` | (empty) | Required for Anthropic provider |
| `openaiApiKey` | (empty) | Required for OpenAI; leave empty for local Ollama |
| `neurodiversityProfile` | `neurotypical` | `neurotypical` / `dyslexia` / `autism` / `adhd` |
| `taskGranularity` | `standard` | `combined` / `standard` / `detailed` |
| `fontSize`, `lineSpacing`, `colorScheme`, … | | Visual preferences |

See `package.json → contributes.configuration` for the complete list.

## Development tips

### Hot-reloading prompt templates

Set the `NEUROCODE_PROMPT_HOTRELOAD=1` environment variable when launching
the Extension Development Host. The `PromptTemplateStore` will watch
`resources/prompts/` and reload on change, so you can iterate on prompt
wording without recompiling or reloading the extension.

### Running one test file

```bash
npx jest src/services/prompts           # one directory
npx jest PromptBuilder                  # by filename fragment
npx jest -t "granularity"               # by test-name pattern
```

### Debugging

The `.vscode/launch.json` provides a "Run Extension" configuration.
Set breakpoints anywhere in `src/`, press F5, and a second VS Code window
opens with the extension loaded. Logs go to the
`Output → NeuroCode Adapter` panel.

## Contributing a new feature

See [docs/extending.md](docs/extending.md) for the recipes:

- Adding a new neurodiversity profile (one `register()` call in
  `builtinProfiles.ts`)
- Adding a new LLM provider (implement `LlmProvider` interface, one `case`
  in `ProviderFactory`)
- Adding a new scaffold tool
- Adding a new prompt template or fragment

## Thesis references

Most design decisions are documented at the top of each source file.
For the thesis Design chapter, `docs/architecture.md` and `docs/prompts.md`
are the primary reference documents.
