# NeuroCode Adapter

Adaptive programming assignment views for neurodiverse learners — a VS Code extension.

## Architecture Overview

```
src/
├── extension.ts                              # Entry point (activate/deactivate)
├── core/
│   ├── controller/
│   │   └── NeurocodeController.ts            # Central orchestration hub
│   ├── context/
│   │   ├── ActivityTracker.ts                # Real-time student activity monitoring
│   │   ├── StruggleDetector.ts               # Learning struggle detection heuristics
│   │   └── SessionContext.ts                 # Session context aggregation for LLM
│   └── webview/
│       └── WebviewManager.ts                 # Sidebar webview communication
├── services/
│   ├── mcp/
│   │   ├── McpManager.ts                     # MCP connection lifecycle manager
│   │   └── McpServer.ts                      # MCP server with adaptive tools
│   └── llm/
│       └── AdaptationEngine.ts               # LLM prompt assembly + response validation
├── features/
│   ├── preferences/
│   │   ├── PreferenceManager.ts              # User preference storage & sync
│   │   └── profiles.ts                       # Neurodiversity profile definitions
│   ├── assignments/
│   │   └── AssignmentManager.ts              # Assignment import/parse/progress
│   └── adaptive/
│       ├── AdaptiveRenderer.ts               # HTML view generation
│       └── strategies.ts                     # Per-profile adaptation strategies
└── shared/
    ├── types.ts                              # Shared type definitions
    ├── messages.ts                           # Extension ↔ Webview message protocol
    └── logger.ts                             # Logging utility
```

## Design Patterns (from Cline)

This project borrows proven architectural patterns from the Cline VS Code extension:

| Pattern | Cline Source | Our Implementation |
|---------|-------------|-------------------|
| Central Controller | `Controller` class | `NeurocodeController` — owns all subsystems, routes messages |
| MCP Connection Manager | `McpHub` — multi-server lifecycle | `McpManager` — single-server, stdio-only, with reconnection |
| Context Tracking | `FileContextTracker` — file read/edit tracking | `ActivityTracker` — student behavior event tracking |
| Message Protocol | `ExtensionMessage` / `WebviewMessage` unions | `messages.ts` — typed discriminated unions for our domain |
| Host Abstraction | `HostProvider` singleton | Simplified — direct VS Code API (single platform target) |

## Supported Profiles

| Profile | Key Adaptations |
|---------|----------------|
| **Neurotypical** | Standard presentation, balanced structure |
| **Dyslexia** | Larger fonts, increased spacing, shorter paragraphs, OpenDyslexic font |
| **Autism Spectrum** | Precise language, explicit structure, consistent patterns, checklists |
| **ADHD** | Small chunks, time estimates, summary boxes, progress checkboxes, break reminders |

## Getting Started

```bash
# Install dependencies
npm install

# Development build
npm run compile

# Watch mode
npm run watch

# Production build
npm run package
```

## Configuration

Set in VS Code Settings (`Ctrl+,`):

- `neurocode.neurodiversityProfile` — Select profile type
- `neurocode.adaptiveMode` — Enable/disable LLM adaptations
- `neurocode.anthropicApiKey` — API key for Claude integration
- `neurocode.fontSize` / `fontFamily` / `lineSpacing` — Visual overrides
- `neurocode.focusMode` — Reduce visual distractions
- `neurocode.textToSpeech` — Enable TTS support

## Assignment Format

Assignments are JSON files with sections, metadata, and optional adaptation hints. See `examples/sample-assignment.json` for the complete schema.

## Technology Stack

- **TypeScript** — Type-safe development
- **VS Code Extension API** — IDE integration
- **Model Context Protocol (MCP)** — LLM communication standard
- **Anthropic Claude** — AI-powered adaptation engine
- **esbuild** — Fast bundling
- **marked** — Markdown rendering

## License

MIT
