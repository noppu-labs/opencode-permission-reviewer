import { describe, expect, test } from "bun:test";
import type { ReasoningHandoff } from "../src/system-one/system-one-results.ts";
import { announceHandoff, handoffInfo } from "../src/ui-status-routing.ts";

const JEV = "opencode/jev-1.13-free";
const LUNA = "openai/gpt-6-luna";
const TIMEOUT =
  "System One reviewer failed (TimeoutError): The operation timed out.";

const REASONING: ReasoningHandoff = {
  model: LUNA,
  jevCritical: false,
  escalatedFrom: {
    model: JEV,
    reason: "Jev escalated.",
    trigger: "jev-escalate",
  },
};

describe("hand-off info", () => {
  test("adds the failure kind only to a jev-failure hand-off", () => {
    expect(handoffInfo(JEV, LUNA, "jev-failure", TIMEOUT)).toEqual({
      from: JEV,
      to: LUNA,
      trigger: "jev-failure",
      failureKind: "timeout",
    });
    expect(handoffInfo(JEV, LUNA, "jev-escalate", TIMEOUT)).toEqual({
      from: JEV,
      to: LUNA,
      trigger: "jev-escalate",
    });
    expect(handoffInfo(JEV, LUNA, "jev-failure", "no format here")).toEqual({
      from: JEV,
      to: LUNA,
      trigger: "jev-failure",
    });
  });

  test("announces the hand-off, nothing without a hook, and swallows a throwing hook", () => {
    const seen: unknown[] = [];
    announceHandoff(undefined, REASONING);
    expect(seen).toEqual([]);
    announceHandoff((handoff) => seen.push(handoff), REASONING);
    expect(seen).toEqual([{ from: JEV, to: LUNA, trigger: "jev-escalate" }]);
    expect(() =>
      announceHandoff(() => {
        throw new Error("boom");
      }, REASONING),
    ).not.toThrow();
  });
});
