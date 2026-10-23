import { describe, expect, test } from "bun:test";
import { ReviewAttempt } from "../../src/modules/review/services/review-attempt.ts";
import { evaluateReview } from "../../src/modules/review/services/review-engine.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../src/types.ts";
import {
  choice,
  envelope,
  JEV_ANSWERS,
  type JevScript,
  RISKS,
  reasoningAllow,
  reviewOnce,
  routedBackend,
  routingConfig,
} from "./system-one-fixtures.ts";

const CRITICAL_REASON =
  "Jev rated this request critical risk; a reasoning approval needs manual review.";

const CRITICAL_UNCERTAIN_DENY: JevScript = {
  ...JEV_ANSWERS.uncertainDeny,
  risk_level: choice("critical", RISKS),
};

async function evaluated(
  config: ReviewerConfig,
  jev: JevScript,
  reasoning: ReviewExecutionResult,
): Promise<ReviewExecutionResult> {
  const { backend } = routedBackend(config, jev, async () => reasoning);
  const pending = envelope();
  const attempt = new ReviewAttempt("generation", 60_000);
  try {
    return await evaluateReview(pending.request, config, {
      collect: async () => pending,
      review: (value: ReviewEnvelope) => backend.review(value, attempt),
      active: () => attempt.active(),
      auxiliarySession: () => false,
      observe: () => {},
    });
  } finally {
    attempt.close("finished");
  }
}

describe("a reasoning approval of an uncertain denial rated critical risk", () => {
  test("still reaches you instead of allowing", async () => {
    const { backend, calls } = routedBackend(
      routingConfig("standard", true),
      CRITICAL_UNCERTAIN_DENY,
      async () => reasoningAllow("sufficient"),
    );
    const result = await reviewOnce(backend);
    expect(calls()).toBe(1);
    expect(result).toMatchObject({
      kind: "escalate",
      reason: CRITICAL_REASON,
      reviewerOutcome: "allow",
      decisionSource: "llm-reviewer",
      resolution: "reasoning-escalated",
      reviewerEscalatedFrom: { trigger: "jev-uncertain-deny" },
    });
    expect(result.escalationDisposition).toBeUndefined();
  });

  test("is sent to you by the engine, or denied under escalationMode deny", async () => {
    const manual = await evaluated(
      routingConfig("standard", true),
      CRITICAL_UNCERTAIN_DENY,
      reasoningAllow("sufficient"),
    );
    expect(manual).toMatchObject({
      kind: "escalate",
      escalationDisposition: "manual",
      resolution: "reasoning-escalated",
    });
    const denied = await evaluated(
      routingConfig("standard", true, { escalationMode: "deny" }),
      CRITICAL_UNCERTAIN_DENY,
      reasoningAllow("sufficient"),
    );
    expect(denied).toMatchObject({
      kind: "deny",
      escalationDisposition: "deny",
      resolution: "reasoning-escalated",
    });
  });

  test("a reasoning denial of it is still a denial", async () => {
    const { backend } = routedBackend(
      routingConfig("standard", true),
      CRITICAL_UNCERTAIN_DENY,
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("deny");
    expect(result.resolution).toBeUndefined();
  });

  test("a reasoning approval of an uncertain denial below critical risk stands", async () => {
    const { backend } = routedBackend(
      routingConfig("standard", true),
      JEV_ANSWERS.uncertainDeny,
      async () => reasoningAllow("sufficient"),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("allow");
    expect(result.reviewerEscalatedFrom?.trigger).toBe("jev-uncertain-deny");
  });
});

async function approvedAfter(
  config: ReviewerConfig,
  jev: JevScript,
): Promise<ReviewExecutionResult> {
  const { backend, calls } = routedBackend(config, jev, async () =>
    reasoningAllow("sufficient"),
  );
  const result = await reviewOnce(backend);
  expect(calls()).toBe(1);
  return result;
}

const CRITICAL_ESCALATE: JevScript = {
  ...JEV_ANSWERS.clearEscalate,
  risk_level: choice("critical", RISKS),
};

describe("a reasoning approval after a Jev decision rated critical risk", () => {
  test.each([
    {
      trigger: "jev-gate",
      jev: JEV_ANSWERS.criticalGatedAllow,
      denialReview: false,
    },
    { trigger: "jev-escalate", jev: CRITICAL_ESCALATE, denialReview: false },
    {
      trigger: "jev-uncertain-allow",
      jev: JEV_ANSWERS.uncertainGatedAllow,
      denialReview: false,
    },
    {
      trigger: "jev-uncertain-deny",
      jev: CRITICAL_UNCERTAIN_DENY,
      denialReview: true,
    },
  ])(
    "under reasoning-first, $trigger: needs manual review",
    async ({ trigger, jev, denialReview }) => {
      const result = await approvedAfter(
        routingConfig("reasoning-first", denialReview),
        jev,
      );
      expect(result).toMatchObject({
        kind: "escalate",
        reason: CRITICAL_REASON,
        reviewerOutcome: "allow",
        resolution: "reasoning-escalated",
        reviewerEscalatedFrom: { trigger },
      });
    },
  );

  test.each([
    { trigger: "jev-uncertain-allow", jev: JEV_ANSWERS.uncertainGatedAllow },
    {
      trigger: "jev-escalate",
      jev: {
        ...JEV_ANSWERS.plausibleEscalate,
        risk_level: choice("critical", RISKS),
      },
    },
  ])(
    "in standard mode, $trigger: a reasoning approval stands on its own gates",
    async ({ trigger, jev }) => {
      const result = await approvedAfter(routingConfig("standard"), jev);
      expect(result.kind).toBe("allow");
      expect(result.reviewerEscalatedFrom?.trigger).toBe(trigger);
    },
  );
});
