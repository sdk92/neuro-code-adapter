/**
 * AssignmentParser — PDF-only assignment parser.
 *
 * Supports two tiers:
 *
 *   Tier 1 (best): PDF → send directly to Claude as base64 document
 *     Claude "sees" the original PDF layout — formulas, tables, diagrams preserved.
 *     Requires API key. Solves garbled symbols/formulas from text extraction.
 *
 *   Tier 2 (offline fallback): PDF → pdf-parse text extraction → heuristic parsing
 *     No API key needed. Basic structure detection only.
 */
import * as path from "path";
import * as fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import type { Assignment, AssignmentSection, AssignmentMetadata } from "@shared/types";
import { Logger } from "@shared/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max file size for PDF parsing (borrowed from Cline's 20MB limit) */
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** Simple cache to avoid re-parsing the same file */
const extractionCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── PDF Text Extraction (Tier 2 offline fallback) ──────────────────────────

/**
 * Extract text from a PDF buffer using pdf-parse.
 * Used only when no API key is available (Tier 2 fallback).
 *
 * Import from "pdf-parse/lib/pdf-parse" (NOT the main entry).
 * The main entry tries to load a test PDF during require(), which fails
 * in bundled environments (esbuild/webpack).
 */
async function extractPdfText(buffer: Buffer, cacheKey?: string): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `PDF file too large (${Math.round(buffer.length / 1024 / 1024)}MB). ` +
      `Maximum supported size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`
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
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function clearExtractionCache(): void {
  extractionCache.clear();
}

// ─── PDF Direct Vision — Tier 1 ─────────────────────────────────────────────

/**
 * Prompt for Tier 1 (direct PDF input).
 *
 * Task sections MUST use a standardised three-part layout so every assignment
 * the student sees has a predictable, homogeneous structure:
 *
 *   ### Background
 *   ### What to do
 *   ### Acceptance criteria
 *
 * This lets the adaptive renderer and the student reliably locate each part
 * regardless of how the original PDF was formatted.
 */
const PDF_STRUCTURING_PROMPT = `You are a document parser for an educational platform.
You will receive a PDF file of a programming assignment. Analyze the ENTIRE document and extract its structure into JSON.

CRITICAL: Your response must be ONLY valid JSON — no markdown fences, no explanation, no preamble.
Do NOT output any text before or after the JSON object.

The JSON must match this schema exactly:
{
  "metadata": {
    "id": "string (generate from title, e.g. 'csharp-calculator-101')",
    "title": "string",
    "description": "string (1-2 sentence summary)",
    "author": "string (or 'Unknown')",
    "createdAt": "ISO date string",
    "updatedAt": "ISO date string",
    "difficulty": "beginner | intermediate | advanced",
    "estimatedMinutes": number,
    "language": "string (programming language, e.g. 'C#', 'Python')",
    "tags": ["string"]
  },
  "sections": [
    {
      "id": "string (e.g. 'section_0')",
      "title": "string",
      "content": "string (Markdown formatted — see layout rules below)",
      "type": "instruction | task | hint | example | reference",
      "order": number
    }
  ],
  "starterCode": "string or null (if starter code is provided in the document)",
  "testCases": []
}

Layout rules:
- For sections of type "task", the content field MUST use exactly this three-part Markdown structure:

  ### Background
  [Why this task exists and what concept it reinforces — 1-3 sentences]

  ### What to do
  [Numbered list of concrete, actionable steps]

  ### Acceptance criteria
  [Bullet list describing how the student knows the task is complete]

- For all other section types (instruction, hint, example, reference), write content as free Markdown.
- Detect section boundaries from headings, numbered items, or topic changes.
- Preserve mathematical formulas in LaTeX notation (e.g. $x^2$, $$\\sum_{i=1}^{n}$$).
- Preserve code blocks in Markdown format (triple backticks with language identifier).
- Convert tables to Markdown table syntax.
- Describe diagrams/figures as [Figure: description].
- Detect the programming language from context.
- If difficulty is not stated, infer from content complexity.
- Estimate completion time based on number and complexity of tasks.

Remember: Output ONLY the JSON object. No other text.`;

/**
 * Send PDF directly to Claude as a base64 document (Tier 1).
 *
 * Bypasses pdf-parse entirely — Claude sees the PDF exactly as a student would:
 * layout, formulas, tables, code blocks, everything preserved.
 */
async function structureViaDirectPdf(
  pdfBuffer: Buffer,
  apiKey: string,
  fileName: string
): Promise<Assignment> {
  const client = new Anthropic({ apiKey });
  const base64Data = pdfBuffer.toString("base64");

  Logger.log(`Tier 1: Sending PDF directly to Claude: ${fileName} (${Math.round(pdfBuffer.length / 1024)}KB)`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: PDF_STRUCTURING_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Data,
            },
          } as any,
          {
            type: "text" as const,
            text: `Parse this programming assignment PDF ("${fileName}") into the structured JSON format specified in your instructions.`,
          },
        ],
      },
      // Prefill to force JSON output immediately
      {
        role: "assistant",
        content: "{",
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Claude response");
  }


  // Claude's response continues from the prefilled "{", so prepend it back
  let jsonStr = "{" + textBlock.text.trim();
  const jsonMatch = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  return validateAndNormalise(parsed, fileName);
}

// ─── Heuristic Parsing — Tier 2 offline fallback ────────────────────────────

/**
 * Parse raw text into sections using heuristic rules.
 * Used only when no API key is available.
 */
// REFACTORED: Exported for independent testing (previously private).
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
    if (regex.test(rawText)) {
      detectedLanguage = lang;
      break;
    }
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
  if (codeMatch) {
    starterCode = codeMatch[1].trim();
  }

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
    case "task":
    case "exercise":
    case "step":
    case "part":
      return "task";
    case "hint":
    case "note":
      return "hint";
    case "example":
      return "example";
    case "reference":
      return "reference";
    default:
      return "instruction";
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

// ─── Validation ──────────────────────────────────────────────────────────────

export function validateAndNormalise(raw: any, fileName: string): Assignment {
  if (!raw || typeof raw !== "object") {
    throw new Error("Parsed result is not an object");
  }

  const metadata: AssignmentMetadata = {
    id: String(raw.metadata?.id ?? `assignment_${Date.now()}`),
    title: String(raw.metadata?.title ?? path.basename(fileName, path.extname(fileName))),
    description: String(raw.metadata?.description ?? ""),
    author: String(raw.metadata?.author ?? "Unknown"),
    createdAt: String(raw.metadata?.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.metadata?.updatedAt ?? new Date().toISOString()),
    difficulty: ["beginner", "intermediate", "advanced"].includes(raw.metadata?.difficulty)
      ? raw.metadata.difficulty
      : "intermediate",
    estimatedMinutes: typeof raw.metadata?.estimatedMinutes === "number" ? raw.metadata.estimatedMinutes : 60,
    language: String(raw.metadata?.language ?? "Unknown"),
    tags: Array.isArray(raw.metadata?.tags) ? raw.metadata.tags.map(String) : [],
  };

  const sections: AssignmentSection[] = Array.isArray(raw.sections)
    ? raw.sections.map((s: any, i: number) => ({
        id: String(s.id ?? `section_${i}`),
        title: String(s.title ?? `Section ${i + 1}`),
        content: String(s.content ?? ""),
        type: ["instruction", "task", "hint", "example", "reference"].includes(s.type) ? s.type : "instruction",
        order: typeof s.order === "number" ? s.order : i,
      }))
    : [];

  if (sections.length === 0) {
    throw new Error("Assignment must contain at least one section");
  }

  return {
    metadata,
    sections,
    starterCode: typeof raw.starterCode === "string" ? raw.starterCode : undefined,
    testCases: Array.isArray(raw.testCases) ? raw.testCases : undefined,
    adaptationHints: typeof raw.adaptationHints === "object" ? raw.adaptationHints : undefined,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a PDF assignment file into a structured Assignment object.
 *
 * @param fileBuffer - Raw PDF content as Buffer
 * @param fileName - Original file name (used for metadata)
 * @param apiKey - Optional Anthropic API key for Tier 1 (direct PDF to Claude)
 */
export async function parseAssignmentFile(
  fileBuffer: Buffer,
  fileName: string,
  apiKey?: string
): Promise<Assignment> {
  // Tier 1: Direct PDF to Claude (best quality, requires API key)
  if (apiKey) {
    try {
      return await structureViaDirectPdf(fileBuffer, apiKey, fileName);
    } catch (error) {
      Logger.warn("Tier 1 (direct PDF) failed, falling back to heuristics:", error);
    }
  }

  // Tier 2: Text extraction → heuristic parsing (offline fallback)
  Logger.log("Tier 2: Extracting text and parsing via heuristics...");
  const rawText = await extractPdfText(fileBuffer, fileName);

  if (!rawText || rawText.trim().length === 0) {
    throw new Error(
      "PDF appears to be empty or image-only. " +
      "Configure an Anthropic API key (neurocode.anthropicApiKey) " +
      "for direct PDF reading with formula/symbol support."
    );
  }

  Logger.log(`PDF text extracted: ${rawText.length} characters from ${fileName}`);
  return structureViaHeuristics(rawText, fileName);
}
