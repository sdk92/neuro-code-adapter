# Extending NeuroCode Adapter

Recipes for common extensions. Every recipe aims to be a single-file
change (at most two files).

## Add a new neurodiversity profile

Goal: add `dyscalculia` as a fifth supported profile.

**Step 1 — Define the module** in
`src/features/adaptive/builtinProfiles.ts`:

```ts
import { ProfileRegistry, type NeurodiversityModule } from "@shared/ProfileRegistry";

const dyscalculiaModule: NeurodiversityModule = {
  type: "dyscalculia",

  profile: {
    type: "dyscalculia",
    label: "Dyscalculia",
    description: "Number sense difficulties; prefer visual math representations",
    defaultPreferences: {
      visual: { /* ...font, spacing, colorScheme... */ },
      structural: { /* ...chunking, disclosure... */ },
      cognitive: { /* ...simplifiedLanguage: true, showExamples: true... */ },
    },
  },

  strategy: {
    cssVariables: { "--nc-code-bg": "#f0f9ff" /* ... */ },
    containerClasses: ["nc-profile-dyscalculia"],
    collapseCodeBlocks: false,
    addCheckboxes: true,
    insertDividers: true,
    addSummaryBoxes: true,
    maxParagraphLength: 400,
    showTimeEstimates: false,
  },

  ruleBasedAdapter: (section, prefs) => ({
    originalSectionId: section.id,
    adaptedTitle: section.title,
    adaptedContent: section.content,
    visualModifications: [
      { type: "highlight", target: "numbers", value: "underline" },
    ],
    structuralChanges: [],
  }),

  promptFragment: `For students with dyscalculia, prefer visual number
representations (tally marks, number lines), avoid dense numeric tables,
and always include worked examples with step-by-step arithmetic.`,
};
```

**Step 2 — Register it** in `registerBuiltinProfiles()` at the bottom of
the same file:

```ts
export function registerBuiltinProfiles(): void {
  ProfileRegistry.register(neurotypicalModule);
  ProfileRegistry.register(dyslexiaModule);
  ProfileRegistry.register(autismModule);
  ProfileRegistry.register(adhdModule);
  ProfileRegistry.register(dyscalculiaModule); // ← new
}
```

**Step 3 — Extend the schema enum** in
`src/shared/schemas/primitives.ts`:

```ts
export const BuiltInNeurodiversityTypes = [
  "neurotypical", "dyslexia", "autism", "adhd",
  "dyscalculia",  // ← new
] as const;
```

**Step 4 — Surface it in the UI**:

- `package.json → contributes.configuration.neurocode.neurodiversityProfile.enum`
  add `"dyscalculia"`
- `src/features/preferences/PreferenceManager.ts → generatePreferencesHtml`
  add `<option value="dyscalculia">Dyscalculia</option>`

That's it. Every consumer (renderer, adaptation engine, preference
manager, message validator) picks up the new profile automatically via
`ProfileRegistry`.

## Add a new LLM provider

Goal: add Google Gemini as a third provider option.

**Step 1 — Implement the interface** in
`src/services/llm/GeminiProvider.ts`:

```ts
import type {
  LlmProvider,
  LlmCompletionParams,
  LlmTextResponse,
  LlmToolCompletionParams,
  LlmToolResponse,
} from "./LlmProvider";

export class GeminiProvider implements LlmProvider {
  readonly name = "Google Gemini";
  readonly supportsDocumentInput = true;

  constructor(
    private readonly apiKey: string,
    public readonly model: string,
  ) {}

  async complete(params: LlmCompletionParams): Promise<LlmTextResponse> {
    // Map LlmMessage → Gemini SDK request, call API, map response back
    ...
  }

  async completeWithTools(params: LlmToolCompletionParams): Promise<LlmToolResponse> {
    ...
  }

  dispose(): void {}
}
```

**Step 2 — Add to the factory** in
`src/services/llm/ProviderFactory.ts`:

```ts
import { GeminiProvider } from "./GeminiProvider";

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.5-pro",  // ← new
};

switch (config.provider) {
  case "anthropic": return new AnthropicProvider(config.apiKey, model);
  case "openai":    return new OpenAiProvider(config.apiKey, model, config.baseUrl);
  case "gemini":    return new GeminiProvider(config.apiKey, model); // ← new
  default: throw new Error(...);
}
```

**Step 3 — Extend the provider enum** in
`src/services/llm/LlmProvider.ts`:

```ts
export type LlmProviderType = "anthropic" | "openai" | "gemini";
```

**Step 4 — Extend the config schema** in
`src/shared/ConfigService.ts`:

```ts
export interface NeurocodeConfig {
  ...
  llmProvider: "anthropic" | "openai" | "gemini";
  geminiApiKey: string;  // ← new
}
```

and in `readFromVscode()`:

```ts
geminiApiKey: c.get<string>("geminiApiKey", ""),
```

**Step 5 — Surface in `package.json`**:

```json
"neurocode.llmProvider": {
  "enum": ["anthropic", "openai", "gemini"],
  ...
},
"neurocode.geminiApiKey": {
  "type": "string",
  "default": "",
  "description": "API key for Google Gemini"
}
```

**Step 6 — Update key resolution** in `NeurocodeController.rebuildProvider()`:

```ts
const apiKey =
  config.llmProvider === "openai" ? config.openaiApiKey :
  config.llmProvider === "gemini" ? config.geminiApiKey :
  config.anthropicApiKey;
```

Done. `AdaptationEngine`, `ScaffoldEngine`, and `AssignmentManager`
pick up the new provider via the `setProvider()` callback.

## Add a new MCP server

The MCP client already handles arbitrary servers — there's nothing to
extend in code. Users add servers via the `connect_mcp` webview message
or through a future settings UI:

```ts
webview.postMessage({
  type: "connect_mcp",
  url: "https://my-mcp-server.example.com/mcp",
  transport: "streamableHttp",
});
```

For local stdio servers, pass a path instead of a URL:

```ts
webview.postMessage({
  type: "connect_mcp",
  url: "/usr/local/bin/my-mcp-server",
});
```

`NeurocodeController.connectMcp()` detects the `http://` / `https://`
prefix and picks the transport. Stdio servers are invoked with `node
<path>`.

**If you want the adaptation tool to be callable from your MCP server**,
implement an `adapt_assignment` tool in your server that accepts
`{ sectionContent, neurodiversityType, preferences }` and returns
text content matching `AdaptationResponseSchema`. `AdaptationEngine`
preferentially routes to MCP when connected — see
`generateViaMcp()`.

## Add a new scaffold tool

Goal: add a `run_tests` tool so the scaffold agent can verify the
student's project.

**Step 1 — Implement the tool** in
`src/features/scaffold/tools/RunTestsTool.ts`:

```ts
import type { NeurocodeToolDef } from "@shared/types";

export const runTestsTool: NeurocodeToolDef = {
  name: "run_tests",
  description() {
    return "Run the project's test suite and return the output. " +
           "Requires a package.json with a 'test' script.";
  },
  inputSchema: {
    type: "object",
    properties: {
      cwd: {
        type: "string",
        description: "Working directory relative to workspace root"
      },
    },
    required: ["cwd"],
  },
  requiresApproval: true,
  isReadOnly: false,
  promptFragment: "run_tests — executes npm test in a subdirectory",

  async call(input, context) {
    // Use the shared CommandExecutor
    const executor = getCommandExecutor();
    const result = await executor.run(
      "npm test",
      { cwd: input.cwd, workspaceRoot: context.workspaceRoot },
    );
    return {
      toolUseId: context.toolUseId,
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
      error: result.exitCode !== 0 ? "Tests failed" : undefined,
    };
  },
};
```

**Step 2 — Register it** in `src/features/scaffold/tools/index.ts`:

```ts
import { runTestsTool } from "./RunTestsTool";

export function registerBuiltinTools(): void {
  ScaffoldToolRegistry.register(createFileTool);
  ScaffoldToolRegistry.register(executeCommandTool);
  ScaffoldToolRegistry.register(openInEditorTool);
  ScaffoldToolRegistry.register(runTestsTool);  // ← new
}
```

Done. The tool is automatically advertised to the LLM via
`buildToolsForAssignment()` and dispatched by `ScaffoldEngine.executeTool()`.

## Add a prompt template or fragment

See [prompts.md — checklist at the bottom](prompts.md#checklist-adding-a-new-fragment).

## Add a webview message type

Goal: add a new `bookmark_section` message that the webview can send
when a student bookmarks a section.

**Step 1 — Define the schema** in
`src/shared/schemas/webview-messages.ts`:

```ts
const BookmarkSectionMessage = z.object({
  type: z.literal("bookmark_section"),
  sectionId: z.string(),
  note: z.string().optional(),
});
```

Then add it to the discriminated union:

```ts
export const WebviewMessageSchema = z.discriminatedUnion("type", [
  ...
  BookmarkSectionMessage,  // ← new
]);
```

**Step 2 — Handle it** in
`NeurocodeController.handleWebviewMessage()`:

```ts
case "bookmark_section":
  this.assignmentManager.bookmarkSection(message.sectionId, message.note);
  break;
```

**Step 3 — Emit from the webview** (in the webview's JS):

```js
vscode.postMessage({
  type: "bookmark_section",
  sectionId: "section_2",
  note: "Revisit this when I've finished task 1",
});
```

The `validateWebviewMessage` pipeline automatically validates the new
message — no separate registration needed because the schema *is* the
validator.

## Add an Extension → Webview message

Complements the above: webview needs to hear about bookmark state from
the extension.

**Step 1 — Add to the union** in `src/shared/messages.ts`:

```ts
export type ExtensionMessage =
  ...
  | { type: "bookmark_added"; sectionId: string; bookmarkId: string };
```

**Step 2 — Send from the extension**:

```ts
this.webview.postMessage({
  type: "bookmark_added",
  sectionId,
  bookmarkId,
});
```

**Step 3 — Handle in the webview**:

```js
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "bookmark_added") {
    // update UI
  }
});
```

There's no Zod validation on the extension-to-webview direction — the
extension is trusted. If you want webview-side defensive parsing, you
can reuse the same Zod schemas (they work in browsers as well as Node).

## Regenerate test infrastructure after adding code

After any of the above:

```bash
npx tsc --noEmit              # check types
npx jest                       # run the suite (165 existing tests)
```

Consider adding a test for the new code:

- New profile → add a case to `ProfileRegistry.test.ts`
- New provider → stub test in a new `__tests__/GeminiProvider.test.ts`
- New scaffold tool → stub test in a new `__tests__/RunTestsTool.test.ts`
- New message type → add a case to `MessageValidator.test.ts` covering
  accepted shapes, rejected shapes, and field-level validation errors
