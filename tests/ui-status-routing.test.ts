import { describe, expect, test } from "bun:test";
import type {
  DecisionSource,
  ReasoningHandoff,
} from "../src/kernel/review-result.ts";
import type { ReviewerConfig } from "../src/kernel/reviewer-config.ts";
import {
  announceHandoff,
  configNoticeFields,
  decidedByField,
  handoffInfo,
  resultHandoff,
  statusRouting,
} from "../src/modules/status/services/ui-status-routing.ts";

const JEV = "opencode/jev-1.13-free";
const LUNA = "openai/gpt-6-luna";
const TIMEOUT =
  "System One reviewer failed (TimeoutError): The operation timed out.";

const REASONING_REVIEWER: Pick<ReviewerConfig, "escalationReviewer"> = {
  escalationReviewer: {
    model: LUNA,
    variant: "high",
    outputFormat: "json_schema",
    timeoutMs: 120_000,
  },
};

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

describe("routing fields of a result", () => {
  test("builds the hand-off only from a recorded trigger and a configured reasoning reviewer", () => {
    const escalatedFrom = {
      model: JEV,
      reason: TIMEOUT,
      trigger: "jev-failure" as const,
    };
    expect(
      resultHandoff(
        { reviewerEscalatedFrom: escalatedFrom },
        REASONING_REVIEWER,
      ),
    ).toEqual({
      from: JEV,
      to: LUNA,
      trigger: "jev-failure",
      failureKind: "timeout",
    });
    expect(
      resultHandoff(
        { reviewerEscalatedFrom: { model: JEV, reason: "x" } },
        REASONING_REVIEWER,
      ),
    ).toBeUndefined();
    expect(
      resultHandoff({ reviewerEscalatedFrom: escalatedFrom }, {}),
    ).toBeUndefined();
    expect(resultHandoff({}, REASONING_REVIEWER)).toBeUndefined();
  });

  test("passes resolution and disposition through and prefers an explicit hand-off", () => {
    const explicit = {
      from: JEV,
      to: "other/model",
      trigger: "jev-gate" as const,
    };
    expect(
      statusRouting(
        {
          handoff: explicit,
          reviewerEscalatedFrom: {
            model: JEV,
            reason: "x",
            trigger: "jev-escalate",
          },
          resolution: "reasoning-escalated",
          escalationDisposition: "deny",
        },
        REASONING_REVIEWER,
      ),
    ).toEqual({
      handoff: explicit,
      resolution: "reasoning-escalated",
      escalationDisposition: "deny",
    });
    expect(statusRouting({}, REASONING_REVIEWER)).toEqual({});
  });

  test("carries only non-empty config lists", () => {
    expect(
      configNoticeFields({ configWarnings: ["w"], configDegraded: [] }),
    ).toEqual({ configWarnings: ["w"] });
    expect(configNoticeFields({})).toEqual({});
  });
});

describe("the model a final status credits", () => {
  test.each<[DecisionSource, string | undefined]>([
    ["system-one-reviewer", JEV],
    ["llm-reviewer", JEV],
    ["emergency-brake", undefined],
    ["deterministic-policy", undefined],
    ["manual-superseded", undefined],
    ["failure-safe", undefined],
  ])("a %s result credits %p", (decisionSource, decidedBy) => {
    expect(
      decidedByField({ decisionSource, reviewerModel: JEV }, { model: LUNA }),
    ).toEqual(decidedBy === undefined ? {} : { decidedBy });
  });

  test("falls back to the configured model, and credits nobody without a source", () => {
    expect(
      decidedByField({ decisionSource: "llm-reviewer" }, { model: LUNA }),
    ).toEqual({ decidedBy: LUNA });
    expect(decidedByField({ reviewerModel: JEV }, { model: LUNA })).toEqual({});
  });
});
