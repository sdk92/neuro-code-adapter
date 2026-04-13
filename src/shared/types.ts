/**
 * Shared type definitions for NeuroCode Adapter.
 * Central type registry used across all modules.
 */

// ─── Neurodiversity Profiles ────────────────────────────────────────────────

export type NeurodiversityType = "neurotypical" | "dyslexia" | "autism" | "adhd";

export interface NeurodiversityProfile {
  type: NeurodiversityType;
  label: string;
  description: string;
  defaultPreferences: Partial<UserPreferences>;
}

// ─── User Preferences ───────────────────────────────────────────────────────

export interface VisualPreferences {
  colorScheme: "default" | "high-contrast" | "warm" | "cool" | "pastel";
  fontSize: number;
  fontFamily: string;
  lineSpacing: number;
  letterSpacing: number;
  paragraphSpacing: number;
  maxLineWidth: number;
}

export interface StructuralPreferences {
  chunkSize: "small" | "medium" | "large";
  progressiveDisclosure: boolean;
  showStepNumbers: boolean;
  showCheckboxes: boolean;
  bulletStyle: "bullets" | "numbers" | "icons";
  sectionCollapsible: boolean;
  /** How task sections are broken down:
   *  - combined: merge related tasks into broader milestones
   *  - standard: keep original task structure from the assignment
   *  - detailed: break each task into atomic sub-steps with clear acceptance criteria
   */
  taskGranularity: "combined" | "standard" | "detailed";
}

export interface CognitivePreferences {
  focusMode: boolean;
  textToSpeech: boolean;
  highlightCurrentStep: boolean;
  showTimers: boolean;
  breakReminders: boolean;
  breakIntervalMinutes: number;
  simplifiedLanguage: boolean;
  showExamples: boolean;
}

export interface UserPreferences {
  neurodiversityType: NeurodiversityType;
  visual: VisualPreferences;
  structural: StructuralPreferences;
  cognitive: CognitivePreferences;
}

// ─── Assignment Types ───────────────────────────────────────────────────────

export interface AssignmentMetadata {
  id: string;
  title: string;
  description: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedMinutes: number;
  language: string;
  tags: string[];
}

export interface AssignmentSection {
  id: string;
  title: string;
  content: string;         // Markdown content
  type: "instruction" | "task" | "hint" | "example" | "reference";
  order: number;
  children?: AssignmentSection[];
}

export interface AssignmentTestCase {
  id: string;
  description: string;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

export interface Assignment {
  metadata: AssignmentMetadata;
  sections: AssignmentSection[];
  starterCode?: string;
  testCases?: AssignmentTestCase[];
  adaptationHints?: Record<NeurodiversityType, string>;
}

// ─── Adaptation Types ───────────────────────────────────────────────────────

export interface AdaptationRequest {
  assignment: Assignment;
  userPreferences: UserPreferences;
  requestType: "full_adaptation" | "help_request";
  targetSectionId?: string;
}

/**
 * LLM response schema — ensures consistency and interpretability.
 * This is the predefined schema mentioned in the project specification.
 */
export interface AdaptationResponse {
  adaptedSections: AdaptedSection[];
  supportMessage?: string;
  suggestedActions?: SuggestedAction[];
  reasoning: string;           // Explainability: why these adaptations were made
  confidenceScore: number;     // 0.0 - 1.0
}

export interface AdaptedSection {
  originalSectionId: string;
  adaptedTitle: string;
  adaptedContent: string;     // Adapted HTML/Markdown
  visualModifications: VisualModification[];
  structuralChanges: string[];
}

export interface VisualModification {
  type: "color" | "font" | "spacing" | "highlight" | "icon" | "border";
  target: string;
  value: string;
}

export interface SuggestedAction {
  type: "break" | "simplify" | "example" | "hint" | "encouragement" | "restructure";
  message: string;
  priority: "low" | "medium" | "high";
}

// ─── Scaffold Types ─────────────────────────────────────────────────────────

export interface ScaffoldRequest {
  assignment: Assignment;
  workspaceRoot: string;
}

export interface ToolExecutionResult {
  toolUseId: string;
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Context passed to every tool during execution.
 * Decouples tools from knowing about ScaffoldEngine internals.
 */
export interface ToolExecutionContext {
  toolUseId: string;
  workspaceRoot: string;
  onProgress: (message: string, isDone: boolean) => void;
  requestApproval: (title: string, detail: string) => Promise<boolean>;
}

/**
 * NeurocodeToolDef — Self-contained tool definition.
 *
 * Inspired by Claude Code's Tool<Input, Output, P> interface.
 * Each tool bundles its own:
 *   - API schema (name, description, input_schema for the LLM)
 *   - Execution logic (call)
 *   - Permission check (requiresApproval)
 *   - Self-description (isReadOnly, promptFragment)
 *
 * Adding a new tool = create one object satisfying this interface
 * and register it. No switch chains, no ScaffoldEngine edits.
 */
export interface NeurocodeToolDef {
  /** Tool name as the LLM will call it (e.g. "execute_command") */
  readonly name: string;

  /** Human-readable description sent to the LLM */
  description(hints?: string[]): string;

  /** JSON Schema for the tool's input parameters */
  readonly inputSchema: Record<string, unknown>;

  /** Execute the tool. Returns success/failure + output. */
  call(
    input: Record<string, string>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;

  /** Whether this tool requires user approval before execution */
  requiresApproval: boolean;

  /** Whether this tool is read-only (no side effects) */
  isReadOnly: boolean;

  /** Optional prompt fragment injected into the system prompt */
  promptFragment?: string;
}

export interface ScaffoldProgress {
  message: string;
  isDone: boolean;
}

// ─── MCP Types ──────────────────────────────────────────────────────────────

export type McpConnectionStatus = "connected" | "connecting" | "disconnected";

export interface McpServerInfo {
  name: string;
  status: McpConnectionStatus;
  error?: string;
  tools?: McpToolInfo[];
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: object;
}

export interface McpToolCallResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}
