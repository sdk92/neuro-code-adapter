/**
 * AssignmentParser — Multi-format assignment parser.
 *
 * Handles the reality that assignments come as PDFs, not JSON.
 * Supports three input formats with a three-tier parsing strategy:
 *
 *   Tier 1 (best): PDF → send directly to Claude as base64 document
 *     Claude "sees" the original PDF layout — formulas, tables, diagrams preserved.
 *     Requires API key. Solves garbled symbols/formulas from text extraction.
 *
 *   Tier 2 (good): PDF → pdf-parse text extraction → Claude structuring
 *     Fallback if Tier 1 fails. May lose formula formatting.
 *     Requires API key.
 *
 *   Tier 3 (basic): PDF → pdf-parse text extraction → heuristic parsing
 *     Offline fallback. No API key needed. Basic structure detection only.
 *
 * For JSON input: direct parse, no LLM needed.
 * For Markdown input: Tier 2 or Tier 3.
 */
import * as path from "path";
import * as fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import type { Assignment, AssignmentSection, AssignmentMetadata } from "@shared/types";
import { Logger } from "@shared/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max file size for PDF parsing (borrowed from Cline's 20MB limit) */
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** Simple cache to avoid re-parsing the same file (borrowed from Cline's dedup in ReadFileToolHandler) */
const extractionCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── PDF Text Extraction ─────────────────────────────────────────────────────

/**
 * Extract text from a PDF buffer using pdf-parse.
 *
 * Key Cline borrowings:
 *   1. Import from "pdf-parse/lib/pdf-parse" (NOT the main entry).
 *      Cline's extract-text.ts uses this sub-path because the main entry
 *      of pdf-parse tries to load a test PDF during require(), which fails
 *      in bundled environments (esbuild/webpack). The /lib/pdf-parse path
 *      gives us the core parser directly.
 *   2. 20MB file size limit (Cline's process-files.ts).
 *   3. Dedup cache pattern (Cline's ReadFileToolHandler avoids re-reading).
 */
async function extractPdfText(buffer: Buffer, cacheKey?: string): Promise<string> {
  // Check file size limit (Cline pattern: 20MB cap)
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `PDF file too large (${Math.round(buffer.length / 1024 / 1024)}MB). ` +
      `Maximum supported size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`
    );
  }

  // Check cache (Cline's dedup pattern)
  if (cacheKey) {
    const cached = extractionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      Logger.debug(`PDF cache hit: ${cacheKey}`);
      return cached.text;
    }
  }

  try {
    // IMPORTANT: Import from sub-path, not main entry.
    // Cline's extract-text.ts: import pdf from "pdf-parse/lib/pdf-parse"
    // The main "pdf-parse" entry tries to load a test PDF during require(),
    // which breaks in esbuild-bundled VS Code extensions.
    const pdf = require("pdf-parse/lib/pdf-parse");
    const data = await pdf(buffer);
    const text: string = data.text;

    // Cache the result
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

/**
 * Clear the extraction cache. Called when memory pressure is detected
 * or when the extension is deactivated.
 */
export function clearExtractionCache(): void {
  extractionCache.clear();
}

// ─── LLM-Based Structuring ──────────────────────────────────────────────────

const STRUCTURING_PROMPT = `You are a document parser for an educational platform.
Given the raw text of a programming assignment, extract and structure it into JSON.

You MUST respond with ONLY valid JSON matching this schema (no markdown, no explanation):
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
      "content": "string (Markdown formatted)",
      "type": "instruction | task | hint | example | reference",
      "order": number
    }
  ],
  "starterCode": "string or null (if starter code is provided in the document)",
  "testCases": [] (extract if mentioned, otherwise empty array)
}

Rules:
- Detect section boundaries from headings, numbered items, or topic changes
- Classify each section: "instruction" for explanations, "task" for things the student must do,
  "hint" for tips, "example" for code examples, "reference" for API/syntax references
- Preserve code blocks in Markdown format (triple backticks)
- Detect the programming language from context
- If difficulty is not stated, infer from content complexity
- Estimate completion time based on number and complexity of tasks`;

/**
 * System prompt specifically for Tier 1 (direct PDF input).
 *
 * Key differences from STRUCTURING_PROMPT:
 *   - References "the attached PDF" instead of "raw text"
 *   - Adds explicit instructions for preserving visual elements
 *   - Reinforces JSON-only output constraint
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
      "content": "string (Markdown formatted)",
      "type": "instruction | task | hint | example | reference",
      "order": number
    }
  ],
  "starterCode": "string or null (if starter code is provided in the document)",
  "testCases": [] (extract if mentioned, otherwise empty array)
}

Rules:
- Detect section boundaries from headings, numbered items, or topic changes
- Classify each section: "instruction" for explanations, "task" for things the student must do,
  "hint" for tips, "example" for code examples, "reference" for API/syntax references
- Preserve mathematical formulas in LaTeX notation (e.g. $x^2$, $$\\sum_{i=1}^{n}$$)
- Preserve code blocks in Markdown format (triple backticks with language identifier)
- Convert tables to Markdown table syntax
- Describe diagrams/figures as [Figure: description]
- Detect the programming language from context
- If difficulty is not stated, infer from content complexity
- Estimate completion time based on number and complexity of tasks

Remember: Output ONLY the JSON object. No other text.`;

/**
 * Use Claude to structure raw text into an Assignment.
 *
 * Borrows Cline's pattern from process-files.ts:
 *   Content is wrapped in <file_content path="..."> XML tags
 *   to give the LLM clear boundaries and source context.
 */
async function structureViaLlm(
  rawText: string,
  apiKey: string,
  fileName: string
): Promise<Assignment> {
  const client = new Anthropic({ apiKey });

  // Cline wraps extracted content in XML tags (process-files.ts):
  //   <file_content path="assignment.pdf">...text...</file_content>
  // This gives the LLM clear document boundaries.
  const wrappedContent = `<file_content path="${fileName}">\n${rawText}\n</file_content>`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: STRUCTURING_PROMPT,
    messages: [
      {
        role: "user",
        content: `Parse this assignment document into structured JSON:\n\n${wrappedContent}`,
      },
      // Prefill to force JSON output (same technique as Tier 1)
      {
        role: "assistant",
        content: "{",
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in LLM response");
  }

  // Extract JSON (may be wrapped in code blocks)
  // Prepend "{" since we prefilled the assistant response with it
  let jsonStr = "{" + textBlock.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  return validateAndNormalise(parsed, fileName);
}

// ─── PDF Direct Vision (bypass text extraction) ─────────────────────────────

/**
 * Send PDF directly to Claude as a base64 document.
 *
 * This BYPASSES pdf-parse entirely, solving:
 *   - Mathematical formulas rendered as garbled text
 *   - Special Unicode symbols lost in extraction
 *   - Table layouts collapsed into flat text
 *   - Diagrams and images completely lost
 *
 * The Anthropic API natively supports PDF as a document input type.
 * Claude "sees" the PDF exactly as a student would — layout, formulas,
 * tables, code blocks, everything preserved.
 *
 * This approach also aligns with the TODO to potentially eliminate the
 * intermediate Assignment JSON step: Claude reads the original PDF
 * and structures it in one pass.
 */
async function structureViaDirectPdf(
  pdfBuffer: Buffer,
  apiKey: string,
  fileName: string
): Promise<Assignment> {
  const client = new Anthropic({ apiKey });

  const base64Data = pdfBuffer.toString("base64");

  Logger.log(`Sending PDF directly to Claude: ${fileName} (${Math.round(pdfBuffer.length / 1024)}KB)`);
  Logger.log(`[DEBUG-v2] Using PDF_STRUCTURING_PROMPT + prefill, max_tokens=8192`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: PDF_STRUCTURING_PROMPT,
    messages: [
      {
        role: "user",
        // The document type is supported by the Anthropic API for PDF input.
        // Type assertion needed because SDK type definitions may lag behind API capabilities.
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
      // ── Prefill: force Claude to start outputting JSON immediately ──
      // By providing the opening brace as an assistant message, Claude
      // MUST continue with valid JSON rather than prose or code.
      // See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response
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

  // ── DEBUG: dump raw response to file for inspection ──
  const debugDir = path.join(path.dirname(fileName), "..", "debug");
  try {
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    // Full API response (all content blocks, stop_reason, usage, etc.)
    fs.writeFileSync(
      path.join(debugDir, `tier1_full_response_${timestamp}.json`),
      JSON.stringify(response, null, 2),
      "utf-8"
    );
    // Just the raw text block that we'll try to parse as JSON
    fs.writeFileSync(
      path.join(debugDir, `tier1_raw_text_${timestamp}.txt`),
      textBlock.text,
      "utf-8"
    );
    Logger.log(`DEBUG: Response dumped to ${debugDir}/tier1_*_${timestamp}.*`);
  } catch (debugErr) {
    Logger.warn("DEBUG: Failed to write debug files:", debugErr);
  }
  // ── END DEBUG ──

  // Claude's response continues from the prefilled "{", so prepend it back
  let jsonStr = "{" + textBlock.text.trim();

  // Strip markdown code fences if Claude still wraps the output
  const jsonMatch = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  return validateAndNormalise(parsed, fileName);
}

/**
 * Parse raw text into sections using heuristic rules.
 * Used when no LLM is available.
 *
 * Detection strategy:
 *   1. Lines matching /^#{1,3}\s/ → Markdown headings → section boundaries
 *   2. Lines matching /^\d+[\.\)]\s/ → Numbered sections
 *   3. Lines matching /^(Task|Exercise|Step|Part)\s/i → Task sections
 *   4. Code blocks (triple backticks) → kept within their parent section
 *   5. Everything else → content paragraphs
 */
function structureViaHeuristics(rawText: string, fileName: string): Assignment {
  const lines = rawText.split("\n");
  const sections: AssignmentSection[] = [];

  let currentTitle = "Introduction";
  let currentContent: string[] = [];
  let currentType: AssignmentSection["type"] = "instruction";
  let sectionIndex = 0;

  // Detect programming language from content
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
    // Detect Markdown headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushSection();
      currentTitle = headingMatch[2];
      currentType = classifySectionTitle(currentTitle);
      continue;
    }

    // Detect numbered sections (e.g., "1. Setup", "2) Implementation")
    const numberedMatch = line.match(/^(\d+)[.\)]\s+(.+)/);
    if (numberedMatch && numberedMatch[2].length > 3 && !line.startsWith("   ")) {
      // Only treat as section header if it's not indented (not a list item)
      flushSection();
      currentTitle = numberedMatch[2];
      currentType = classifySectionTitle(currentTitle);
      continue;
    }

    // Detect labelled sections (e.g., "Task:", "Exercise 1:", "Step 3:")
    const labelledMatch = line.match(/^(Task|Exercise|Step|Part|Section|Hint|Example|Note|Reference)\s*\d*\s*[:—\-]\s*(.*)/i);
    if (labelledMatch) {
      flushSection();
      currentTitle = labelledMatch[2] || labelledMatch[1];
      currentType = classifyLabel(labelledMatch[1]);
      continue;
    }

    currentContent.push(line);
  }

  // Flush remaining content
  flushSection();

  // Filter out empty sections
  const nonEmpty = sections.filter((s) => s.content.length > 0);

  // Build metadata
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

  // Extract starter code if found
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

/**
 * Classify a section title into a section type.
 */
function classifySectionTitle(title: string): AssignmentSection["type"] {
  const lower = title.toLowerCase();
  if (/task|exercise|implement|create|build|write|code|develop/.test(lower)) { return "task"; }
  if (/hint|tip|advice|note/.test(lower)) { return "hint"; }
  if (/example|sample|demo/.test(lower)) { return "example"; }
  if (/reference|api|syntax|appendix|glossary/.test(lower)) { return "reference"; }
  return "instruction";
}

/**
 * Classify a labelled section prefix into a section type.
 */
function classifyLabel(label: string): AssignmentSection["type"] {
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

/**
 * Infer difficulty from content complexity.
 */
function inferDifficulty(text: string): AssignmentMetadata["difficulty"] {
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

/**
 * Validate and normalise a parsed assignment object.
 */
function validateAndNormalise(raw: any, fileName: string): Assignment {
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

export type SupportedFormat = "json" | "pdf" | "markdown";

/**
 * Detect file format from extension.
 */
export function detectFormat(filePath: string): SupportedFormat {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf": return "pdf";
    case ".md":
    case ".markdown":
    case ".txt":
      return "markdown";
    default: return "json";
  }
}

/**
 * Parse an assignment file into a structured Assignment object.
 *
 * @param fileBuffer - Raw file content as Buffer
 * @param fileName - Original file name (used for format detection and metadata)
 * @param apiKey - Optional Anthropic API key for LLM-based structuring
 */
export async function parseAssignmentFile(
  fileBuffer: Buffer,
  fileName: string,
  apiKey?: string
): Promise<Assignment> {
  const format = detectFormat(fileName);

  switch (format) {
    case "json": {
      // JSON — direct parse, no LLM needed
      const text = fileBuffer.toString("utf-8");
      const parsed = JSON.parse(text);
      return validateAndNormalise(parsed, fileName);
    }

    case "pdf": {
      // PDF parsing strategy (3-tier fallback):
      //
      //   Tier 1: Send PDF directly to Claude (API key required)
      //           Claude "sees" the original PDF — formulas, tables, diagrams all preserved.
      //           No text extraction needed. Solves garbled symbols/formulas problem.
      //
      //   Tier 2: Extract text via pdf-parse → LLM structuring (API key required)
      //           Fallback if direct PDF fails (e.g. file too large for API).
      //           May lose formulas and special symbols.
      //
      //   Tier 3: Extract text via pdf-parse → heuristic parsing (no API key needed)
      //           Offline fallback. Basic structure detection only.

      // Tier 1: Direct PDF to Claude (best quality)
      if (apiKey) {
        try {
          Logger.log("Tier 1: Sending PDF directly to Claude...");
          return await structureViaDirectPdf(fileBuffer, apiKey, fileName);
        } catch (error) {
          Logger.warn("Direct PDF failed, falling back to text extraction:", error);
        }
      }

      // Tier 2 & 3: Text extraction path
      const rawText = await extractPdfText(fileBuffer, fileName);

      if (!rawText || rawText.trim().length === 0) {
        throw new Error(
          "PDF appears to be empty or image-only. " +
          "Configure an Anthropic API key (neurocode.anthropicApiKey) " +
          "for direct PDF reading with formula/symbol support."
        );
      }

      Logger.log(`PDF text extracted: ${rawText.length} characters from ${fileName}`);

      // Tier 2: Text + LLM structuring
      /*
      if (apiKey) {
        try {
          Logger.log("Tier 2: Structuring extracted text via LLM...");
          return await structureViaLlm(rawText, apiKey, fileName);
        } catch (error) {
          Logger.warn("LLM structuring failed, using heuristics:", error);
        }
      }
      */
      // Tier 3: Heuristic parsing (offline)
      Logger.log("Tier 3: Structuring via heuristics...");
      return structureViaHeuristics(rawText, fileName);
    }

    case "markdown": {
      // Markdown — treat as raw text and structure
      const rawText = fileBuffer.toString("utf-8");

      if (apiKey) {
        try {
          return await structureViaLlm(rawText, apiKey, fileName);
        } catch (error) {
          Logger.warn("LLM structuring failed, using heuristics:", error);
        }
      }

      return structureViaHeuristics(rawText, fileName);
    }
  }
}