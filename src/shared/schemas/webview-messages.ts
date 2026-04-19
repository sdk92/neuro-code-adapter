/**
 * Webview message schemas — discriminated union over `type`.
 *
 * Replaces MESSAGE_SCHEMAS + validateWebviewMessage() in MessageValidator.ts.
 *
 * Why discriminated union:
 *   The original code had a FieldSpec table and a loop checking typeof.
 *   That's roughly what Zod does internally, but Zod does it with correct
 *   TypeScript narrowing: after .safeParse succeeds, the caller gets a
 *   WebviewMessage with `type` narrowed, and TS knows the right per-variant
 *   fields exist. The old code's `message as unknown as WebviewMessage`
 *   double-cast was a lie to the compiler.
 *
 * Trust boundary note:
 *   Webview messages come from the webview JavaScript. That JS runs in an
 *   isolated context, but treats the message bus as trusted. A compromised
 *   webview (or a future fuzzing setup) could send arbitrary shapes.
 *   Strict schema parsing at the boundary is the right place to enforce
 *   contracts — not deep in handleWebviewMessage where a missing field
 *   manifests as a confusing TypeError.
 */
import { z } from "zod";
import {
  McpTransportSchema,
  NeurodiversityTypeSchema,
} from "./primitives";
import { PartialUserPreferencesSchema } from "./preferences";

// ─── Webview → Extension message variants ────────────────────────────────────

const ReadyMessage = z.object({ type: z.literal("ready") });
const RequestStateMessage = z.object({ type: z.literal("request_state") });
const OpenAssignmentMessage = z.object({ type: z.literal("open_assignment") });
const OpenPreferencesMessage = z.object({ type: z.literal("open_preferences") });
const DisconnectMcpMessage = z.object({ type: z.literal("disconnect_mcp") });
const RequestScaffoldMessage = z.object({ type: z.literal("request_scaffold") });

const RequestHelpMessage = z.object({
  type: z.literal("request_help"),
  question: z.string().optional(),
  sectionId: z.string().optional(),
});

const SetProfileMessage = z.object({
  type: z.literal("set_profile"),
  profile: NeurodiversityTypeSchema,
});

const ConnectMcpMessage = z.object({
  type: z.literal("connect_mcp"),
  url: z.string().url({ message: "MCP URL must be a valid URL" }).or(z.string().startsWith("/")),
  transport: McpTransportSchema.optional(),
});

const ApplyPreferencesMessage = z.object({
  type: z.literal("apply_preferences"),
  preferences: PartialUserPreferencesSchema,
});

const ScaffoldApprovalResponseMessage = z.object({
  type: z.literal("scaffold_approval_response"),
  toolUseId: z.string(),
  approved: z.boolean(),
});

// ─── Discriminated union (inferrable) ────────────────────────────────────────

/**
 * The complete, strictly-typed WebviewMessage schema.
 *
 * Using z.discriminatedUnion instead of z.union gives:
 *   - Constant-time dispatch on `type` (no trial-and-error through variants)
 *   - Much better error messages ("Invalid discriminator 'foo'" vs a tree
 *     of per-variant failures)
 *   - TypeScript narrowing after parse — consumers get real exhaustiveness
 *     checking in switch statements.
 */
export const WebviewMessageSchema = z.discriminatedUnion("type", [
  ReadyMessage,
  RequestStateMessage,
  OpenAssignmentMessage,
  OpenPreferencesMessage,
  DisconnectMcpMessage,
  RequestScaffoldMessage,
  RequestHelpMessage,
  SetProfileMessage,
  ConnectMcpMessage,
  ApplyPreferencesMessage,
  ScaffoldApprovalResponseMessage,
]);

export type WebviewMessage = z.infer<typeof WebviewMessageSchema>;
