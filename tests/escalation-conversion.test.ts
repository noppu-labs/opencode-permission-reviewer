import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { applyEscalationDisposition } from "../src/escalation.ts";
import type { ReviewExecutionResult, ReviewerConfig } from "../src/types.ts";
import { decision, systemOneScores } from "./helpers.ts";

const DENY_MODE: ReviewerConfig = { ...DEFAULT_CONFIG, escalationMode: "deny" };

function fullEscalate(): ReviewExecutionResult {
  return {
    kind: "escalate",
    decision: decision("allow", {
      risk_level: "high",
      user_authorization: "low",
    }),
    reason: "needs a human",
    reviewSessionID: "ses_review",
    decisionSource: "llm-reviewer",
    reviewerModel: "fixture/reviewer",
    reviewerEscalatedFrom: { model: "fixture/primary", reason: "low margin" },
    systemOne: systemOneScores(),
    reviewerOutcome: "allow",
    escalationDisposition: "manual",
  };
}

describe("escalation conversion to deny", () => {
  test("every carried field is kept, in order, and the disposition is replaced", () => {
    const input = fullEscalate();
    const result = applyEscalationDisposition(input, DENY_MODE);
    expect(result).toEqual({
      ...input,
      kind: "deny",
      escalationDisposition: "deny",
    });
    expect(Object.keys(result)).toEqual([
      "kind",
      "reason",
      "decision",
      "reviewSessionID",
      "decisionSource",
      "reviewerOutcome",
      "reviewerModel",
      "reviewerEscalatedFrom",
      "systemOne",
      "escalationDisposition",
    ]);
  });

  test("a bare escalate carries only kind, reason and disposition", () => {
    const result = applyEscalationDisposition(
      { kind: "escalate", reason: "timed out" },
      DENY_MODE,
    );
    expect(result).toEqual({
      kind: "deny",
      reason: "timed out",
      escalationDisposition: "deny",
    });
    expect(Object.keys(result)).toEqual([
      "kind",
      "reason",
      "escalationDisposition",
    ]);
  });

  test("the reviewer outcome falls back to the decision outcome", () => {
    const result = applyEscalationDisposition(
      { kind: "escalate", reason: "gated", decision: decision("escalate") },
      DENY_MODE,
    );
    expect(result.reviewerOutcome).toBe("escalate");
  });

  test("an explicit reviewer outcome wins over the decision outcome", () => {
    const result = applyEscalationDisposition(
      {
        kind: "escalate",
        reason: "gated",
        decision: decision("escalate"),
        reviewerOutcome: "allow",
      },
      DENY_MODE,
    );
    expect(result.reviewerOutcome).toBe("allow");
  });
});

describe("escalation kept for a human", () => {
  test("a decision supplies the reviewer outcome after the existing fields", () => {
    const input: ReviewExecutionResult = {
      kind: "escalate",
      reason: "gated",
      decision: decision("allow"),
      decisionSource: "llm-reviewer",
    };
    const result = applyEscalationDisposition(input, DEFAULT_CONFIG);
    expect(result).toEqual({
      ...input,
      reviewerOutcome: "allow",
      escalationDisposition: "manual",
    });
    expect(Object.keys(result)).toEqual([
      "kind",
      "reason",
      "decision",
      "decisionSource",
      "reviewerOutcome",
      "escalationDisposition",
    ]);
  });

  test("without a decision no reviewer outcome is added", () => {
    const result = applyEscalationDisposition(
      { kind: "escalate", reason: "timed out", decisionSource: "failure-safe" },
      DEFAULT_CONFIG,
      "reviewer-failure",
    );
    expect(result).toEqual({
      kind: "escalate",
      reason: "timed out",
      decisionSource: "failure-safe",
      escalationDisposition: "manual",
    });
    expect("reviewerOutcome" in result).toBe(false);
  });

  test.each<ReviewExecutionResult>([
    { kind: "allow", reason: "ok" },
    { kind: "deny", reason: "no" },
    {
      kind: "escalate",
      reason: "answered",
      decisionSource: "manual-superseded",
    },
  ])("$kind ($reason) is returned as the same object", (input) => {
    expect(applyEscalationDisposition(input, DENY_MODE)).toBe(input);
  });
});
