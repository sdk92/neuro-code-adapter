/**
 * StruggleDetector unit tests.
 *
 * Design borrowed from Cline's test patterns:
 *   - FileContextTracker.test.ts: uses sinon sandbox, stubs, and mocha
 *   - ModelContextTracker.test.ts: fake timers for timestamp control
 *
 * These tests demonstrate the project's testability claims:
 *   1. Constructor injection: ActivityTracker is injected, easily mocked
 *   2. Configurable thresholds: passed via constructor params
 *   3. getAndClear pattern: easy to assert on accumulated indicators
 *   4. No network/API dependency: pure logic testing
 */

// ─── Mock ActivityTracker ────────────────────────────────────────────────────
// Demonstrates constructor injection testability: we don't need a real
// VS Code environment, just an object that satisfies the interface.

import type { ActivityEvent } from "@shared/types";

class MockActivityTracker {
  private events: ActivityEvent[] = [];
  private idleDuration: number = 0;
  private fileSwitchCount: number = 0;

  // Test helpers
  addEvent(type: ActivityEvent["type"], data: Record<string, unknown> = {}): void {
    this.events.push({ timestamp: Date.now(), type, data });
  }

  setIdleDuration(ms: number): void {
    this.idleDuration = ms;
  }

  setFileSwitchCount(count: number): void {
    this.fileSwitchCount = count;
  }

  // ActivityTracker interface methods
  peekEvents(windowMs?: number): ActivityEvent[] {
    if (windowMs === undefined) { return [...this.events]; }
    const cutoff = Date.now() - windowMs;
    return this.events.filter((e) => e.timestamp > cutoff);
  }

  getCurrentIdleDuration(): number {
    return this.idleDuration;
  }

  getRecentFileSwitchCount(_windowMs?: number): number {
    return this.fileSwitchCount;
  }

  reset(): void {
    this.events = [];
    this.idleDuration = 0;
    this.fileSwitchCount = 0;
  }
}

// ─── Import (uses type-compatible mock) ──────────────────────────────────────
import { StruggleDetector } from "@core/context/StruggleDetector";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("StruggleDetector", () => {
  let tracker: MockActivityTracker;
  let detector: StruggleDetector;

  beforeEach(() => {
    tracker = new MockActivityTracker();
    // Use low thresholds for fast testing
    detector = new StruggleDetector(tracker as any, {
      repeatedEditsCount: 3,
      repeatedEditsWindowMs: 60_000,
      longPauseMs: 5_000,
      rapidSwitchCount: 3,
      rapidSwitchWindowMs: 30_000,
      cooldownMs: 0, // Disable cooldown for testing
    });
  });

  afterEach(() => {
    detector.dispose();
  });

  test("should detect repeated edits when threshold exceeded", () => {
    // Simulate 5 edits in the same file
    for (let i = 0; i < 5; i++) {
      tracker.addEvent("file_edit", { filePath: "src/main.cs" });
    }

    // Manually trigger detection (instead of waiting for interval)
    (detector as any).detectAll();

    const indicators = detector.getAndClearIndicators();
    expect(indicators.length).toBe(1);
    expect(indicators[0].type).toBe("repeated_edits");
    expect(indicators[0].severity).toBe("medium");
    expect(indicators[0].context.filePath).toBe("src/main.cs");
  });

  test("should detect high severity when edits are 2x threshold", () => {
    // 6 edits = 2x threshold of 3
    for (let i = 0; i < 6; i++) {
      tracker.addEvent("file_edit", { filePath: "src/main.cs" });
    }

    (detector as any).detectAll();

    const indicators = detector.getAndClearIndicators();
    expect(indicators[0].severity).toBe("high");
  });

  test("should detect long pause", () => {
    tracker.setIdleDuration(10_000); // 10 seconds idle (threshold is 5s)

    (detector as any).detectAll();

    const indicators = detector.getAndClearIndicators();
    expect(indicators.length).toBe(1);
    expect(indicators[0].type).toBe("long_pause");
  });

  test("should detect rapid file switching", () => {
    tracker.setFileSwitchCount(5); // 5 switches (threshold is 3)

    (detector as any).detectAll();

    const indicators = detector.getAndClearIndicators();
    expect(indicators.length).toBe(1);
    expect(indicators[0].type).toBe("rapid_switching");
  });

  test("should not detect when below thresholds", () => {
    // Only 2 edits (threshold is 3)
    tracker.addEvent("file_edit", { filePath: "src/main.cs" });
    tracker.addEvent("file_edit", { filePath: "src/main.cs" });

    tracker.setIdleDuration(1_000); // 1s idle (threshold is 5s)
    tracker.setFileSwitchCount(1);  // 1 switch (threshold is 3)

    (detector as any).detectAll();

    const indicators = detector.getAndClearIndicators();
    expect(indicators.length).toBe(0);
  });

  test("should detect multiple types simultaneously", () => {
    // Trigger all three types at once
    for (let i = 0; i < 5; i++) {
      tracker.addEvent("file_edit", { filePath: "src/main.cs" });
    }
    tracker.setIdleDuration(10_000);
    tracker.setFileSwitchCount(5);

    (detector as any).detectAll();

    const indicators = detector.getAndClearIndicators();
    expect(indicators.length).toBe(3);

    const types = indicators.map((i) => i.type).sort();
    expect(types).toEqual(["long_pause", "rapid_switching", "repeated_edits"]);
  });

  test("should clear indicators after getAndClear", () => {
    tracker.setIdleDuration(10_000);
    (detector as any).detectAll();

    // First call returns indicators
    const first = detector.getAndClearIndicators();
    expect(first.length).toBe(1);

    // Second call returns empty (already cleared)
    const second = detector.getAndClearIndicators();
    expect(second.length).toBe(0);
  });

  test("should record help seeking as low severity", () => {
    detector.recordHelpSeeking("section_1");

    const indicators = detector.getAndClearIndicators();
    expect(indicators.length).toBe(1);
    expect(indicators[0].type).toBe("help_seeking");
    expect(indicators[0].severity).toBe("low");
    expect(indicators[0].context.sectionId).toBe("section_1");
  });

  test("should respect cooldown period", () => {
    // Create detector with 10s cooldown
    const cooldownDetector = new StruggleDetector(tracker as any, {
      repeatedEditsCount: 3,
      repeatedEditsWindowMs: 60_000,
      longPauseMs: 5_000,
      rapidSwitchCount: 3,
      rapidSwitchWindowMs: 30_000,
      cooldownMs: 10_000, // 10 second cooldown
    });

    tracker.setIdleDuration(10_000);

    // First detection
    (cooldownDetector as any).detectAll();
    const first = cooldownDetector.getAndClearIndicators();
    expect(first.length).toBe(1);

    // Second detection within cooldown — should NOT emit
    (cooldownDetector as any).detectAll();
    const second = cooldownDetector.getAndClearIndicators();
    expect(second.length).toBe(0);

    cooldownDetector.dispose();
  });

  test("should reset all state", () => {
    tracker.setIdleDuration(10_000);
    (detector as any).detectAll();

    detector.reset();

    const indicators = detector.getAndClearIndicators();
    expect(indicators.length).toBe(0);
  });
});
