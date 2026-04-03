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

// ─── Context & Tracking Types ───────────────────────────────────────────────

export interface ActivityEvent {
  timestamp: number;
  type: "file_open" | "file_edit" | "cursor_move" | "section_view" | "help_request"
    | "pause" | "resume" | "assignment_open" | "assignment_close";
  data: Record<string, unknown>;
}

export interface StruggleIndicator {
  timestamp: number;
  type: "repeated_edits" | "long_pause" | "rapid_switching" | "error_loop" | "help_seeking";
  severity: "low" | "medium" | "high";
  context: {
    filePath?: string;
    sectionId?: string;
    details: string;
  };
}

export interface SessionContext {
  sessionId: string;
  startedAt: number;
  assignmentId?: string;
  activeFile?: string;
  currentSection?: string;
  timeOnTask: number;
  activityEvents: ActivityEvent[];
  struggleIndicators: StruggleIndicator[];
  editCount: number;
  filesSeen: string[];
}

// ─── Adaptation Types ───────────────────────────────────────────────────────

export interface AdaptationRequest {
  assignment: Assignment;
  userPreferences: UserPreferences;
  sessionContext: SessionContext;
  requestType: "full_adaptation" | "section_adaptation" | "help_request" | "struggle_support";
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
