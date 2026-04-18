/**
 * AssignmentParser — PDF-only assignment parser.
 *
 * REFACTORED (M1): PDF structuring prompts moved to resources/prompts/pdf-structuring/.
 * The prompt text is no longer co-located with the parsing logic — editing it
 * no longer requires recompiling the extension.
 *
 * Tier 1 (best): PDF → base64 → provider.complete() with document input
 * Tier 2 (offline fallback): pdf-parse text extraction → heuristic parsing
 */
import * as path from "path";
import type { LlmProvider } from "@services/llm/LlmProvider";
import type { Assignment, AssignmentSection, AssignmentMetadata } from "@shared/types";
import { AssignmentSchema } from "@shared/schemas";
import type { PromptBuilder } from "@services/prompts";
import { Logger } from "@shared/logger";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const extractionCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── PDF text extraction (Tier 2) ────────────────────────────────────────────

async function extractPdfText(buffer: Buffer, cacheKey?: string): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `PDF file too large (${Math.round(buffer.length / 1024 / 1024)}MB). ` +
      `Maximum supported size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
    );
  }

  if (cacheKey) {
    const cached = extractionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      Logger.debug(`PDF cache hit: ${cacheKey}`);
      return cached.text;
    }
  }

  try {
    const pdf = require("pdf-parse/lib/pdf-parse");
    const data = await pdf(buffer);
    const text: string = data.text;
    if (cacheKey) {
      extractionCache.set(cacheKey, { text, timestamp: Date.now() });
    }
    return text;
  } catch (error) {
    Logger.error("PDF parsing failed:", error);
    throw new Error(
      `Failed to parse PDF. Ensure pdf-parse is installed (npm install pdf-parse). ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function clearExtractionCache(): void {
  extractionCache.clear();
}

// ─── Tier 1: direct PDF input via LLM (now template-driven) ─────────────────

async function structureViaDirectPdf(
  pdfBuffer: Buffer,
  provider: LlmProvider,
  fileName: string,
  promptBuilder: PromptBuilder,
): Promise<Assignment> {
  if (!provider.supportsDocumentInput) {
    throw new Error("Provider does not support document input — falling back to Tier 2");
  }

  const base64Data = pdfBuffer.toString("base64");

  Logger.log(
    `Tier 1: Sending PDF to ${provider.name} (${provider.model}): ` +
    `${fileName} (${Math.round(pdfBuffer.length / 1024)}KB)`,
  );

  // REFACTORED: prompts pulled from resources/prompts/ — no hardcoded strings here.
  const systemPrompt = promptBuilder
    .from("pdf-structuring.system")
    .buildText();

  const userPrompt = promptBuilder
    .from("pdf-structuring.user", { fileName })
    .buildText();

  const response = await provider.complete({
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", mediaType: "application/pdf", data: base64Data },
          { type: "text", text: userPrompt },
        ],
      },
      // Prefill "{" to force JSON output immediately
      { role: "assistant", content: "{" },
    ],
    maxTokens: 8192,
  });

  let jsonStr = "{" + response.text.trim();
  const jsonMatch = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  return validateAndNormalise(parsed, fileName);
}

// ─── Tier 2: heuristic parsing (unchanged) ──────────────────────────────────

export function structureViaHeuristics(rawText: string, fileName: string): Assignment {
  const lines = rawText.split("\n");
  const sections: AssignmentSection[] = [];

  let currentTitle = "Introduction";
  let currentContent: string[] = [];
  let currentType: AssignmentSection["type"] = "instruction";
  let sectionIndex = 0;

  const languageHints: Record<string, RegExp> = {
    "C#": /\b(namespace|using\s+System|Console\.Write|\.cs\b|csharp)/i,
    "Python": /\b(def\s+\w+|import\s+\w+|print\(|\.py\b|python)/i,
    "Java": /\b(public\s+class|System\.out|\.java\b|java\b)/i,
    "JavaScript": /\b(const\s+|let\s+|function\s+|console\.log|\.js\b)/i,
    "TypeScript": /\b(interface\s+|type\s+\w+\s*=|\.ts\b|typescript)/i,
  };
  let detectedLanguage = "Unknown";
  for (const [lang, regex] of Object.entries(languageHints)) {
    if (regex.test(rawText)) { detectedLanguage = lang; break; }
  }

  function flushSection() {
    if (currentContent.length > 0 || sectionIndex === 0) {
      sections.push({
        id: `section_${sectionIndex}`,
        title: currentTitle.trim(),
        content: currentContent.join("\n").trim(),
        type: currentType,
        order: sectionIndex,
      });
      sectionIndex++;
      currentContent = [];
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushSection();
      currentTitle = headingMatch[2];
      currentType = classifySectionTitle(currentTitle);
      continue;
    }

    const numberedMatch = line.match(/^(\d+)[.\)]\s+(.+)/);
    if (numberedMatch && numberedMatch[2].length > 3 && !line.startsWith("   ")) {
      flushSection();
      currentTitle = numberedMatch[2];
      currentType = classifySectionTitle(currentTitle);
      continue;
    }

    const labelledMatch = line.match(/^(Task|Exercise|Step|Part|Section|Hint|Example|Note|Reference)\s*\d*\s*[:—\-]\s*(.*)/i);
    if (labelledMatch) {
      flushSection();
      currentTitle = labelledMatch[2] || labelledMatch[1];
      currentType = classifyLabel(labelledMatch[1]);
      continue;
    }

    currentContent.push(line);
  }

  flushSection();

  const nonEmpty = sections.filter((s) => s.content.length > 0);

  const title = nonEmpty.length > 0
    ? nonEmpty[0].title
    : path.basename(fileName, path.extname(fileName));

  const metadata: AssignmentMetadata = {
    id: `assignment_${Date.now()}`,
    title,
    description: nonEmpty.length > 0 ? nonEmpty[0].content.substring(0, 200) : "",
    author: "Unknown",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    difficulty: inferDifficulty(rawText),
    estimatedMinutes: Math.max(15, nonEmpty.length * 10),
    language: detectedLanguage,
    tags: [],
  };

  let starterCode: string | undefined;
  const codeMatch = rawText.match(/```[\w]*\n([\s\S]*?)```/);
  if (codeMatch) { starterCode = codeMatch[1].trim(); }

  return {
    metadata,
    sections: nonEmpty.length > 0 ? nonEmpty : [{
      id: "section_0",
      title: "Assignment Content",
      content: rawText,
      type: "instruction",
      order: 0,
    }],
    starterCode,
  };
}

export function classifySectionTitle(title: string): AssignmentSection["type"] {
  const lower = title.toLowerCase();
  if (/task|exercise|implement|create|build|write|code|develop/.test(lower)) { return "task"; }
  if (/hint|tip|advice|note/.test(lower)) { return "hint"; }
  if (/example|sample|demo/.test(lower)) { return "example"; }
  if (/reference|api|syntax|appendix|glossary/.test(lower)) { return "reference"; }
  return "instruction";
}

export function classifyLabel(label: string): AssignmentSection["type"] {
  switch (label.toLowerCase()) {
    case "task": case "exercise": case "step": case "part": return "task";
    case "hint": case "note": return "hint";
    case "example": return "example";
    case "reference": return "reference";
    default: return "instruction";
  }
}

export function inferDifficulty(text: string): AssignmentMetadata["difficulty"] {
  const complexitySignals = [
    /\b(inheritance|polymorphism|interface|abstract|generic|async|await|delegate|lambda|LINQ)\b/gi,
    /\b(design pattern|architecture|dependency injection|unit test|mock|refactor)\b/gi,
    /\b(algorithm|complexity|O\(n\)|recursion|data structure|tree|graph|hash)\b/gi,
  ];
  let score = 0;
  for (const regex of complexitySignals) {
    const matches = text.match(regex);
    if (matches) { score += matches.length; }
  }
  if (score >= 8) { return "advanced"; }
  if (score >= 3) { return "intermediate"; }
  return "beginner";
}

// ─── Validation (M2: Zod-backed) ─────────────────────────────────────────────

/**
 * Validate and normalise a parsed assignment.
 *
 * REFACTORED (M2): Hand-rolled String(x ?? fallback) chains and
 * ["..."].includes(x) enum checks replaced with AssignmentSchema.safeParse.
 * Filename-derived title fallback is injected before parsing so missing-title
 * cases produce a sensible default (schema's generic default would use
 * "Untitled Assignment" otherwise).
 */
export function validateAndNormalise(raw: unknown, fileName: string): Assignment {
  // Inject filename-derived title fallback BEFORE Zod parses, so the
  // schema's generic default doesn't clobber it.
  const withFilenameDefault =
    raw && typeof raw === "object"
      ? {
          ...(raw as Record<string, unknown>),
          metadata: {
            ...(raw as any).metadata,
            title:
              (raw as any).metadata?.title ??
              path.basename(fileName, path.extname(fileName)),
          },
        }
      : raw;

  const result = AssignmentSchema.safeParse(withFilenameDefault);
  if (!result.success) {
    throw new Error(
      `Assignment validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a PDF assignment file into a structured Assignment.
 *
 * REFACTORED: `promptBuilder` is now required for the Tier 1 path (was previously
 * hardcoded strings). Tier 2 fallback still works without it.
 */
export async function parseAssignmentFile(
  fileBuffer: Buffer,
  fileName: string,
  provider?: LlmProvider,
  promptBuilder?: PromptBuilder,
): Promise<Assignment> {
  if (provider && promptBuilder) {
    try {
      return await structureViaDirectPdf(fileBuffer, provider, fileName, promptBuilder);
    } catch (error) {
      Logger.warn("Tier 1 (direct PDF) failed, falling back to heuristics:", error);
    }
  } else if (provider && !promptBuilder) {
    Logger.warn("Provider available but PromptBuilder not wired — skipping Tier 1");
  }

  Logger.log("Tier 2: Extracting text and parsing via heuristics...");
  const rawText = await extractPdfText(fileBuffer, fileName);

  if (!rawText || rawText.trim().length === 0) {
    throw new Error(
      "PDF appears to be empty or image-only. " +
      "Configure an Anthropic API key (neurocode.anthropicApiKey) " +
      "for direct PDF reading with formula/symbol support.",
    );
  }

  Logger.log(`PDF text extracted: ${rawText.length} characters from ${fileName}`);
  return structureViaHeuristics(rawText, fileName);
}
