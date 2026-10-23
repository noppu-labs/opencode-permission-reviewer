import { describe, expect, test } from "bun:test";
import { DEFAULT_RISK_POLICY } from "../src/modules/config/models/config-risk-policy.ts";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import { parseDecision } from "../src/modules/review/services/decision/decision.ts";
import { enforceDecision } from "../src/modules/review/services/decision/decision-gates.ts";
import type {
  ReviewDecision,
  ReviewerConfig,
  RiskPolicy,
} from "../src/types.ts";
import { decision } from "./helpers.ts";

function raw(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...decision("allow"), ...overrides };
}

function without(key: keyof ReviewDecision): Record<string, unknown> {
  const value: Record<string, unknown> = { ...decision("allow") };
  delete value[key];
  return value;
}

function cfg(
  confidenceThreshold: number,
  riskPolicy: Partial<RiskPolicy> = {},
): ReviewerConfig {
  return {
    ...DEFAULT_CONFIG,
    confidenceThreshold,
    riskPolicy: { ...DEFAULT_RISK_POLICY, ...riskPolicy },
  };
}

describe("decision parsing field checks", () => {
  test.each([
    ["a string", "allow"],
    ["a number", 1],
    ["an array", [decision("allow")]],
    ["no version", without("version")],
    ["version 1", raw({ version: 1 })],
    ["version as a string", raw({ version: "2" })],
    ["no outcome", without("outcome")],
    ["a numeric outcome", raw({ outcome: 1 })],
    ["no risk_level", without("risk_level")],
    ["a numeric risk_level", raw({ risk_level: 7 })],
    ["no user_authorization", without("user_authorization")],
    ["a boolean user_authorization", raw({ user_authorization: true })],
    ["no rationale", without("rationale")],
    ["a numeric rationale", raw({ rationale: 42 })],
    [
      "a rationale of two characters after trimming",
      raw({ rationale: "  ab  " }),
    ],
    ["a rationale over 2000 characters", raw({ rationale: "x".repeat(2001) })],
    ["no confidence", without("confidence")],
    ["a string confidence", raw({ confidence: "0.9" })],
    ["an infinite confidence", raw({ confidence: Number.POSITIVE_INFINITY })],
    ["a negative confidence", raw({ confidence: -0.01 })],
    ["a confidence above 1", raw({ confidence: 1.01 })],
    ["a null script_analysis", raw({ script_analysis: null })],
    ["a numeric script_analysis", raw({ script_analysis: 42 })],
    [
      "a script_analysis under 20 characters",
      raw({ script_analysis: "x".repeat(19) }),
    ],
    [
      "a script_analysis over 1500 characters",
      raw({ script_analysis: "x".repeat(1501) }),
    ],
    ["no scope_alignment", without("scope_alignment")],
    ["a numeric scope_alignment", raw({ scope_alignment: 3 })],
    ["no evidence_completeness", without("evidence_completeness")],
    ["a numeric evidence_completeness", raw({ evidence_completeness: 3 })],
    [
      "an unknown evidence_completeness",
      raw({ evidence_completeness: "complete" }),
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseDecision(value)).toBeUndefined();
  });

  test.each([
    [
      "a rationale of three characters",
      { rationale: "abc" },
      { rationale: "abc" },
    ],
    [
      "a padded rationale, trimmed",
      { rationale: "  abc  " },
      { rationale: "abc" },
    ],
    [
      "a rationale of 2000 characters",
      { rationale: "x".repeat(2000) },
      { rationale: "x".repeat(2000) },
    ],
    ["confidence 0", { confidence: 0 }, { confidence: 0 }],
    ["confidence 1", { confidence: 1 }, { confidence: 1 }],
    [
      "a script_analysis of 20 characters",
      { script_analysis: "s".repeat(20) },
      { script_analysis: "s".repeat(20) },
    ],
    [
      "a script_analysis of 1500 characters",
      { script_analysis: "s".repeat(1500) },
      { script_analysis: "s".repeat(1500) },
    ],
  ])("accepts %s", (_label, overrides, expected) => {
    expect(parseDecision(raw(overrides))).toEqual({
      ...decision("allow"),
      ...expected,
    });
  });

  test("an explicit undefined script_analysis is accepted and left out", () => {
    const parsed = parseDecision(raw({ script_analysis: undefined }));
    expect(parsed).toEqual(decision("allow"));
    expect(parsed !== undefined && "script_analysis" in parsed).toBe(false);
  });

  test("unknown fields are dropped and the keys keep the schema order", () => {
    const parsed = parseDecision(
      raw({ extra: "ignored", script_analysis: "s".repeat(20) }),
    );
    expect(Object.keys(parsed ?? {})).toEqual([
      "version",
      "outcome",
      "risk_level",
      "user_authorization",
      "rationale",
      "confidence",
      "script_analysis",
      "scope_alignment",
      "evidence_completeness",
    ]);
  });
});

describe("decision enforcement gates", () => {
  const CRITICAL =
    "Reviewer returned a non-denial for critical risk; manual review required.";
  const MISALIGNED =
    "Reviewer judged the request misaligned with the stated intent; manual review required.";

  test.each<[string, ReviewDecision, ReviewerConfig, string, string]>([
    [
      "a deny with critical risk and low confidence stays a deny",
      decision("deny", { risk_level: "critical", confidence: 0.1 }),
      DEFAULT_CONFIG,
      "deny",
      "The action has unsafe unrequested effects.",
    ],
    [
      "an escalate with critical risk",
      decision("escalate", { risk_level: "critical", confidence: 0.1 }),
      DEFAULT_CONFIG,
      "escalate",
      CRITICAL,
    ],
    [
      "an escalate below the confidence floor",
      decision("escalate", { confidence: 0.5 }),
      DEFAULT_CONFIG,
      "escalate",
      "Reviewer confidence 0.50 is below 0.70.",
    ],
    [
      "an allow below a confidenceThreshold above minimumConfidence",
      decision("allow", { confidence: 0.8 }),
      cfg(0.9),
      "escalate",
      "Reviewer confidence 0.80 is below 0.90.",
    ],
    [
      "an allow below a minimumConfidence above confidenceThreshold",
      decision("allow", { confidence: 0.8 }),
      cfg(0.7, { minimumConfidence: 0.85 }),
      "escalate",
      "Reviewer confidence 0.80 is below 0.85.",
    ],
    [
      "an allow at exactly the confidence floor",
      decision("allow", { confidence: 0.7 }),
      DEFAULT_CONFIG,
      "allow",
      "The action is narrow, reversible, and explicitly requested.",
    ],
    [
      "an allow whose risk has no row in the allow matrix",
      decision("allow", { risk_level: "medium" }),
      cfg(0.7, {
        allow: { low: ["high"] } as unknown as RiskPolicy["allow"],
      }),
      "escalate",
      "Reviewer allow for medium risk with high user authorization; manual review required.",
    ],
    [
      "an allow outside the matrix that is also misaligned",
      decision("allow", {
        risk_level: "high",
        user_authorization: "low",
        scope_alignment: "misaligned",
      }),
      DEFAULT_CONFIG,
      "escalate",
      "Reviewer allow for high risk with low user authorization; manual review required.",
    ],
    [
      "a misaligned allow with insufficient evidence at medium risk",
      decision("allow", {
        risk_level: "medium",
        scope_alignment: "misaligned",
        evidence_completeness: "insufficient",
      }),
      DEFAULT_CONFIG,
      "escalate",
      MISALIGNED,
    ],
    [
      "an allow with insufficient evidence at high risk",
      decision("allow", {
        risk_level: "high",
        evidence_completeness: "insufficient",
      }),
      DEFAULT_CONFIG,
      "escalate",
      "Reviewer judged evidence insufficient for high risk; manual review required.",
    ],
    [
      "an allow with partial evidence at high risk",
      decision("allow", {
        risk_level: "high",
        evidence_completeness: "partial",
      }),
      DEFAULT_CONFIG,
      "allow",
      "The action is narrow, reversible, and explicitly requested.",
    ],
    [
      "a misaligned escalate keeps its rationale",
      decision("escalate", { scope_alignment: "misaligned" }),
      DEFAULT_CONFIG,
      "escalate",
      "The action has unsafe unrequested effects.",
    ],
  ])("%s", (_label, value, config, kind, reason) => {
    expect(enforceDecision(value, config)).toEqual({
      kind: kind as "allow" | "deny" | "escalate",
      decision: value,
      reason,
      reviewerOutcome: value.outcome,
    });
  });

  test("the result keys keep their order", () => {
    expect(
      Object.keys(enforceDecision(decision("allow"), DEFAULT_CONFIG)),
    ).toEqual(["kind", "decision", "reason", "reviewerOutcome"]);
  });
});
