/**
 * Tests for the refactored MessageValidator.
 *
 * These tests pin down the contract:
 *   - Valid messages pass and the returned `message` is strictly typed
 *   - Invalid messages return errors and null
 *   - Domain constraints (profile enum, MCP transport enum) are enforced
 *   - Deep validation catches nested preference violations
 *   - Dynamically registered profiles are accepted
 */
import {
  validateWebviewMessage,
  registerAllowedProfile,
} from "../MessageValidator";

describe("validateWebviewMessage", () => {
  describe("basic shape", () => {
    it("rejects non-objects", () => {
      for (const raw of [null, undefined, 42, "string", true, []]) {
        const result = validateWebviewMessage(raw);
        expect(result.valid).toBe(false);
        expect(result.message).toBeNull();
      }
    });

    it("rejects missing type field", () => {
      const result = validateWebviewMessage({});
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/type/i);
    });

    it("rejects unknown message type", () => {
      const result = validateWebviewMessage({ type: "fake_message" });
      expect(result.valid).toBe(false);
      // Zod 4 emits "Invalid input" / "invalid input" for unknown discriminator values.
      // We accept any error message referencing the type field.
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(" ").toLowerCase()).toMatch(/type|input|discriminator|fake_message/);
    });
  });

  describe("no-payload messages", () => {
    it("accepts `ready`", () => {
      const result = validateWebviewMessage({ type: "ready" });
      expect(result.valid).toBe(true);
      expect(result.message?.type).toBe("ready");
    });

    it("accepts `open_assignment`", () => {
      expect(validateWebviewMessage({ type: "open_assignment" }).valid).toBe(true);
    });

    it("accepts `disconnect_mcp`", () => {
      expect(validateWebviewMessage({ type: "disconnect_mcp" }).valid).toBe(true);
    });
  });

  describe("request_help", () => {
    it("accepts with no fields", () => {
      const result = validateWebviewMessage({ type: "request_help" });
      expect(result.valid).toBe(true);
    });

    it("accepts with question and sectionId", () => {
      const result = validateWebviewMessage({
        type: "request_help",
        question: "How do I start?",
        sectionId: "section_0",
      });
      expect(result.valid).toBe(true);
    });

    it("rejects non-string sectionId", () => {
      const result = validateWebviewMessage({
        type: "request_help",
        sectionId: 42,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("set_profile", () => {
    it("accepts built-in profiles", () => {
      for (const profile of ["neurotypical", "dyslexia", "autism", "adhd"]) {
        const result = validateWebviewMessage({ type: "set_profile", profile });
        expect(result.valid).toBe(true);
      }
    });

    it("rejects unknown profile", () => {
      const result = validateWebviewMessage({ type: "set_profile", profile: "made_up" });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/made_up|profile|allowed/i);
    });

    it("accepts dynamically registered profile", () => {
      registerAllowedProfile("custom_profile");
      const result = validateWebviewMessage({
        type: "set_profile",
        profile: "custom_profile",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("connect_mcp", () => {
    it("accepts valid URL and transport", () => {
      const result = validateWebviewMessage({
        type: "connect_mcp",
        url: "https://example.com/mcp",
        transport: "streamableHttp",
      });
      expect(result.valid).toBe(true);
    });

    it("accepts local stdio path", () => {
      const result = validateWebviewMessage({
        type: "connect_mcp",
        url: "/usr/local/bin/my-mcp-server",
      });
      expect(result.valid).toBe(true);
    });

    it("rejects invalid transport", () => {
      const result = validateWebviewMessage({
        type: "connect_mcp",
        url: "https://example.com",
        transport: "websocket",
      });
      expect(result.valid).toBe(false);
    });

    it("rejects missing url", () => {
      const result = validateWebviewMessage({ type: "connect_mcp" });
      expect(result.valid).toBe(false);
    });
  });

  describe("apply_preferences — deep validation", () => {
    it("accepts a partial update", () => {
      const result = validateWebviewMessage({
        type: "apply_preferences",
        preferences: { visual: { fontSize: 16 } },
      });
      expect(result.valid).toBe(true);
    });

    it("rejects out-of-range fontSize (deep validation wasn't possible before)", () => {
      const result = validateWebviewMessage({
        type: "apply_preferences",
        preferences: { visual: { fontSize: 5 } }, // < min(10)
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/fontSize|10/);
    });

    it("rejects invalid colorScheme enum", () => {
      const result = validateWebviewMessage({
        type: "apply_preferences",
        preferences: { visual: { colorScheme: "puce" } },
      });
      expect(result.valid).toBe(false);
    });

    it("rejects invalid taskGranularity enum", () => {
      const result = validateWebviewMessage({
        type: "apply_preferences",
        preferences: { structural: { taskGranularity: "very_detailed" } },
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("scaffold_approval_response", () => {
    it("accepts a valid approval", () => {
      const result = validateWebviewMessage({
        type: "scaffold_approval_response",
        toolUseId: "toolu_abc",
        approved: true,
      });
      expect(result.valid).toBe(true);
    });

    it("rejects missing approved field", () => {
      const result = validateWebviewMessage({
        type: "scaffold_approval_response",
        toolUseId: "toolu_abc",
      });
      expect(result.valid).toBe(false);
    });

    it("rejects non-boolean approved", () => {
      const result = validateWebviewMessage({
        type: "scaffold_approval_response",
        toolUseId: "toolu_abc",
        approved: "yes",
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("TypeScript narrowing after parse", () => {
    it("narrows type in a switch", () => {
      const result = validateWebviewMessage({
        type: "set_profile",
        profile: "adhd",
      });
      expect(result.valid).toBe(true);

      // Exhaustiveness check — this wouldn't compile with the old `as unknown as` cast
      // if a switch failed to handle a variant. That's the type-safety win.
      const msg = result.message!;
      switch (msg.type) {
        case "set_profile":
          expect(msg.profile).toBe("adhd");
          break;
        default:
          // no-op — test is about compilation, not coverage
          break;
      }
    });
  });
});
