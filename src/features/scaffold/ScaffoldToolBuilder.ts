/**
 * ScaffoldToolBuilder — Builds a tailored Claude tool set based on assignment content.
 *
 * REFACTORED: Tool definitions now come from ScaffoldToolRegistry. 
 * This file only handles:
 *   1. Collecting language/framework hints
 *   2. Asking the registry to build the Anthropic API tool array
 *   3. Building the system hint string
 *
 * The static tool definitions (execute_command, create_file, open_in_editor)
 * are now in tools/*.ts and registered via registerBuiltinTools().
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Assignment } from "@shared/types";
import { ScaffoldToolRegistry } from "./ScaffoldToolRegistry";

export type AnthropicTool = Anthropic.Tool;

// ─── Language/Framework hints ────────────────────────────────────────────────

const LANGUAGE_HINTS = new Map<string, string>([
  ["typescript", "Use `npm create vite@latest -- --template vanilla-ts` or `npx create-react-app --template typescript`."],
  ["javascript", "Use `npm create vite@latest -- --template vanilla` or `npx create-react-app`."],
  ["python", "Use `python3 -m venv .venv` on Linux/macOS or `python -m venv .venv` on Windows, then activate and pip install."],
  ["csharp", "Use `dotnet new <template>` (console / webapi / mvc / xunit etc.)."],
  ["java", "Use `mvn archetype:generate -DinteractiveMode=false` or `gradle init --type java-application`."],
  ["rust", "Use `cargo init` or `cargo new <n>`."],
  ["go", "Use `go mod init <module>` then create main.go."],
  ["cpp", "Create CMakeLists.txt + src/main.cpp structure."],
]);

const TAG_HINTS = new Map<string, string>([
  ["react", "Bootstrap with `npm create vite@latest -- --template react-ts` (TypeScript) or `--template react`."],
  ["vue", "Bootstrap with `npm create vite@latest -- --template vue-ts`."],
  ["express", "Use `npm init -y && npm install express`."],
  ["fastapi", "Use `pip install fastapi uvicorn` and create main.py with a starter FastAPI app."],
  ["django", "Use `django-admin startproject <n> .`."],
  ["flask", "Use `pip install flask` and create app.py."],
  ["nextjs", "Use `npx create-next-app@latest --ts --no-git`."],
  ["jest", "Add `npm install --save-dev jest @types/jest ts-jest`."],
  ["pytest", "Add `pip install pytest`."],
]);

/**
 * Register a language-specific scaffold hint at runtime.
 */
export function registerLanguageHint(language: string, hint: string): void {
  LANGUAGE_HINTS.set(language.toLowerCase(), hint);
}

/**
 * Register a tag/framework-specific scaffold hint at runtime.
 */
export function registerTagHint(tag: string, hint: string): void {
  TAG_HINTS.set(tag.toLowerCase(), hint);
}

// ─── Builder ────────────────────────────────────────────────────────────────

export interface ScaffoldToolSet {
  tools: AnthropicTool[];
  systemHint: string;
}

/**
 * Build the tool set for a specific assignment.
 *
 * REFACTORED: Delegates to ScaffoldToolRegistry.buildAnthropicTools()
 * instead of maintaining a static array of tool definitions.
 */
export function buildToolsForAssignment(assignment: Assignment): ScaffoldToolSet {
  const lang = assignment.metadata.language?.toLowerCase() ?? "";
  const tags = (assignment.metadata.tags ?? []).map((t) => t.toLowerCase());

  // Collect hints relevant to this assignment
  const hints: string[] = [];

  const langHint = LANGUAGE_HINTS.get(lang);
  if (langHint) { hints.push(langHint); }

  for (const tag of tags) {
    const tagHint = TAG_HINTS.get(tag);
    if (tagHint) { hints.push(tagHint); }
  }

  // Build hints map: only execute_command gets the language/framework hints
  const hintsByTool = new Map<string, string[]>();
  if (hints.length > 0) {
    hintsByTool.set("execute_command", hints);
  }

  // Build Anthropic tool array from registry
  const tools = ScaffoldToolRegistry.buildAnthropicTools(hintsByTool);

  const systemHint = buildSystemHint(assignment, lang, tags, hints);

  return { tools, systemHint };
}

function buildSystemHint(
  assignment: Assignment,
  lang: string,
  tags: string[],
  hints: string[]
): string {
  const lines = [
    `Assignment: "${assignment.metadata.title}"`,
    `Language: ${lang || "not specified"}`,
    tags.length > 0 ? `Tags/frameworks: ${tags.join(", ")}` : "",
    `Difficulty: ${assignment.metadata.difficulty}`,
    `Estimated time: ${assignment.metadata.estimatedMinutes} minutes`,
    "",
    "Your task is to scaffold a starter project for this assignment using the tools provided.",
    `Available tools: ${ScaffoldToolRegistry.getNames().join(", ")}`,
    "Rules:",
    "1. Keep commands non-interactive (pass --yes, -y, or equivalent flags).",
    "2. Prefer minimal, correct scaffolding over feature-rich boilerplate.",
    hints.length > 0 ? `\nPreferred tooling hints:\n${hints.map((h) => `- ${h}`).join("\n")}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}
