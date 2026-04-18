## NeurocodeController.ts — minimal diff

Only three places change. No other lines in this file need to move.

---

### 1. Add import at the top (next to the other `@services` imports)

```ts
import type { PromptBuilder } from "@services/prompts";
```

---

### 2. Update the constructor signature and wire-up

Find this block (around line 86):

```ts
constructor(
  context: vscode.ExtensionContext,
  webview: WebviewManager,
  configService: ConfigService
) {
  // Initialize subsystems
  this.mcpManager = new McpManager();
  this.adaptationEngine = new AdaptationEngine();
  this.preferenceManager = new PreferenceManager(context);
  this.assignmentManager = new AssignmentManager(context);
  this.renderer = new AdaptiveRenderer();
  this.scaffoldEngine = new ScaffoldEngine();
  this.webview = webview;
  this.configService = configService;
```

Replace with:

```ts
constructor(
  context: vscode.ExtensionContext,
  webview: WebviewManager,
  configService: ConfigService,
  promptBuilder: PromptBuilder,           // NEW
) {
  // Initialize subsystems
  this.mcpManager = new McpManager();
  this.adaptationEngine = new AdaptationEngine();
  this.preferenceManager = new PreferenceManager(context);
  this.assignmentManager = new AssignmentManager(context);
  this.renderer = new AdaptiveRenderer();
  this.scaffoldEngine = new ScaffoldEngine();
  this.webview = webview;
  this.configService = configService;

  // NEW (M1): wire the PromptBuilder into subsystems that need it.
  //   AdaptationEngine: all LLM-path prompts
  //   AssignmentManager: Tier 1 PDF structuring prompts
  this.adaptationEngine.setPromptBuilder(promptBuilder);
  this.assignmentManager.setPromptBuilder(promptBuilder);
```

Everything else in the constructor body stays identical.

---

### 3. Optional — log the prompt receipt on each adaptation

This is the telemetry hook. Go to `requestAdaptation()` (around line 383) and find:

```ts
this.currentAdaptation = await this.adaptationEngine.generateAdaptation(request);
```

After this line, add:

```ts
// M1 telemetry: record which prompt templates produced this adaptation.
// Useful for the Evaluation chapter — attribute outputs to template versions.
const adaptation = this.currentAdaptation as any;
if (adaptation?.receipt) {
  Logger.log(
    `[Adaptation] strategy=${adaptation.strategy} ` +
    `manifest=v${adaptation.receipt.manifestVersion} ` +
    `templates=[${adaptation.receipt.templates.map((t: any) => `${t.id}@${t.version}`).join(", ")}]`,
  );
}
```

(If you want this to survive across sessions for the Evaluation chapter,
write it to `context.globalState` under a key like `neurocode.telemetry`
— that's M3 territory.)

---

That's the entire diff. No other changes required.
