/**
 * ScaffoldToolBuilder — Builds a tailored Claude tool set based on assignment content.
 *
 * Core idea: instead of passing a generic, unlimited tool list to the LLM,
 * we inspect the assignment's language/tags/difficulty and produce a minimal,
 * focused set of tools + a scaffold prompt that guides Claude to create
 * exactly the right project skeleton.
 *
 * Tools defined here match Anthropic's Tool schema (tool_use API).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Assignment } from "@shared/types";

export type AnthropicTool = Anthropic.Tool;

// ─── Base tool definitions ──────────────────────────────────────────────────

const EXECUTE_COMMAND_TOOL: AnthropicTool = {
  name: "execute_command",
  description:
    "Run a shell command to scaffold the project (e.g. create-react-app, dotnet new, cargo init). " +
    "Always prefer official project-creation CLIs. Keep commands non-interactive (use --yes / -y flags). " +
    "Each command call must do one logical step only. " +
    "NEVER use `cd` as a standalone command — use the `cwd` parameter instead to set the working directory.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command (optional, defaults to workspace root)",
      },
      description: {
        type: "string",
        description: "One-line human-readable description of what this command does",
      },
    },
    required: ["command", "description"],
  },
};

const CREATE_FILE_TOOL: AnthropicTool = {
  name: "create_file",
  description:
    "Create or overwrite a file with the given content. " +
    "Use this to add starter code, config files, or README. " +
    "Prefer this over running echo/cat in execute_command.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative file path from the workspace root",
      },
      content: {
        type: "string",
        description: "Full file content",
      },
      description: {
        type: "string",
        description: "One-line description of what this file is",
      },
    },
    required: ["path", "content", "description"],
  },
};

const OPEN_IN_EDITOR_TOOL: AnthropicTool = {
  name: "open_in_editor",
  description:
    "Open a file in the VS Code editor after scaffolding is complete. " +
    "Call this last, for the file the student should start editing.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative file path from the workspace root to open",
      },
    },
    required: ["path"],
  },
};

// ─── Language-specific tool hints injected into descriptions ────────────────

const LANGUAGE_HINTS: Record<string, string> = {
  typescript: "Use `npm create vite@latest -- --template vanilla-ts` or `npx create-react-app --template typescript`.",
  javascript: "Use `npm create vite@latest -- --template vanilla` or `npx create-react-app`.",
  python: "Use `python3 -m venv .venv` on Linux/macOS or `python -m venv .venv` on Windows, then activate and pip install.",
  csharp: "Use `dotnet new <template>` (console / webapi / mvc / xunit etc.).",
  java: "Use `mvn archetype:generate -DinteractiveMode=false` or `gradle init --type java-application`.",
  rust: "Use `cargo init` or `cargo new <name>`.",
  go: "Use `go mod init <module>` then create main.go.",
  cpp: "Create CMakeLists.txt + src/main.cpp structure.",
};

// Framework/tag hints injected when tags match
const TAG_HINTS: Record<string, string> = {
  react: "Bootstrap with `npm create vite@latest -- --template react-ts` (TypeScript) or `--template react`.",
  vue: "Bootstrap with `npm create vite@latest -- --template vue-ts`.",
  express: "Use `npm init -y && npm install express`.",
  fastapi: "Use `pip install fastapi uvicorn` and create main.py with a starter FastAPI app.",
  django: "Use `django-admin startproject <name> .`.",
  flask: "Use `pip install flask` and create app.py.",
  nextjs: "Use `npx create-next-app@latest --ts --no-git`.",
  jest: "Add `npm install --save-dev jest @types/jest ts-jest`.",
  pytest: "Add `pip install pytest`.",
};

// ─── Builder ────────────────────────────────────────────────────────────────

export interface ScaffoldToolSet {
  tools: AnthropicTool[];
  systemHint: string; // Extra guidance injected into the system prompt
}

export function buildToolsForAssignment(assignment: Assignment): ScaffoldToolSet {
  const lang = assignment.metadata.language?.toLowerCase() ?? "";
  const tags = (assignment.metadata.tags ?? []).map((t) => t.toLowerCase());

  const hints: string[] = [];

  // Inject language-specific hint into the execute_command description
  const langHint = LANGUAGE_HINTS[lang];
  if (langHint) {
    hints.push(langHint);
  }

  // Inject framework hints for matching tags
  for (const tag of tags) {
    const tagHint = TAG_HINTS[tag];
    if (tagHint) {
      hints.push(tagHint);
    }
  }

  // Patch execute_command tool description with concrete hints
  const patchedExecuteTool: AnthropicTool = hints.length > 0
    ? {
        ...EXECUTE_COMMAND_TOOL,
        description: EXECUTE_COMMAND_TOOL.description + "\n\nPreferred commands for this assignment:\n" +
          hints.map((h) => `- ${h}`).join("\n"),
      }
    : EXECUTE_COMMAND_TOOL;

  const tools: AnthropicTool[] = [
    patchedExecuteTool,
    CREATE_FILE_TOOL,
    OPEN_IN_EDITOR_TOOL,
  ];

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
    "Rules:",
    "1. Use execute_command for CLI scaffolding steps.",
    "2. Use create_file to add or overwrite individual source files.",
    "3. Use open_in_editor ONCE at the very end to open the main entry-point file.",
    "4. Keep commands non-interactive (pass --yes, -y, or equivalent flags).",
    "5. Prefer minimal, correct scaffolding over feature-rich boilerplate.",
    "6. When done, call open_in_editor on the file the student should start editing.",
    hints.length > 0 ? `\nPreferred tooling hints:\n${hints.map((h) => `- ${h}`).join("\n")}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}
