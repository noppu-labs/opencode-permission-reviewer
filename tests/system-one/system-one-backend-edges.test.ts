import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../../src/config.ts";
import { ReviewAttempt } from "../../src/core/review-attempt.ts";
import { evaluateReview } from "../../src/core/review-engine.ts";
import { DEFAULT_TENANT_POLICY } from "../../src/policy.ts";
import { SystemOneReviewerBackend } from "../../src/system-one/backend.ts";
import type { SystemOneState } from "../../src/system-one/review.ts";
import { HANDOFF_BUDGET_FLOOR_MS } from "../../src/system-one/system-one-handoff.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../src/types.ts";
import { GITHUB_PAT_ALPHANUMERIC } from "../fixtures/synthetic-secrets.ts";
import {
  attemptWithRemaining,
  choice,
  envelope,
  JEV_ANSWERS,
  JEV_MODEL,
  type JevScript,
  REASONING_DENY,
  REASONING_ESCALATE,
  REASONING_UNAVAILABLE,
  reasoningAllow,
  response,
  reviewOnce,
  routedBackend,
  routingConfig,
} from "./system-one-fixtures.ts";

const config = resolveConfig({ model: "opencode/jev-1.13-free" });
const REASONING_MODEL = "openai/gpt-5.6-luna";

// A plausibly resolvable Jev escalation, so the backend hands it to reasoning.
function reasoningBackend(
  reasoning: ReviewExecutionResult,
): SystemOneReviewerBackend {
  return new SystemOneReviewerBackend(
    config,
    async () => reasoning,
    REASONING_MODEL,
    async () =>
      response({
        outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
      }),
  );
}

describe("System One backend edges", () => {
  test("never owns a request", () => {
    expect(new SystemOneReviewerBackend(config).owns()).toBe(false);
  });

  test("waitForIdle settles only after every in-flight review", async () => {
    let release: (value: unknown) => void = () => {};
    const backend = new SystemOneReviewerBackend(
      config,
      undefined,
      undefined,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const order: string[] = [];
    const review = reviewOnce(backend).then(() => order.push("review"));
    const idle = backend.waitForIdle().then(() => order.push("idle"));
    await Promise.resolve();
    expect(order).toEqual([]);
    release(response());
    await Promise.all([review, idle]);
    expect(order).toEqual(["review", "idle"]);
    await backend.waitForIdle();
  });

  test("waitForIdle also settles after a failed review", async () => {
    const backend = new SystemOneReviewerBackend(
      config,
      undefined,
      undefined,
      async () => {
        throw new Error("synthetic transport failure");
      },
    );
    const review = reviewOnce(backend);
    await backend.waitForIdle();
    expect((await review).decisionSource).toBe("failure-safe");
  });

  test("sends the redacted tenant policy, or the default one", async () => {
    const states: SystemOneState[] = [];
    const capture = async (state: SystemOneState): Promise<unknown> => {
      states.push(state);
      return response();
    };
    const policy = `Never print ${GITHUB_PAT_ALPHANUMERIC}.`;
    await reviewOnce(
      new SystemOneReviewerBackend(
        { ...config, policy },
        undefined,
        undefined,
        capture,
      ),
    );
    await reviewOnce(
      new SystemOneReviewerBackend(config, undefined, undefined, capture),
    );
    const [custom, fallback] = states;
    expect(custom?.trustedPolicy.tenant).toStartWith("Never print ");
    expect(custom?.trustedPolicy.tenant).not.toContain(GITHUB_PAT_ALPHANUMERIC);
    expect(fallback?.trustedPolicy.tenant).toBe(DEFAULT_TENANT_POLICY);
  });

  test("keeps action evidence incomplete once the envelope says so", async () => {
    const backend = new SystemOneReviewerBackend(
      config,
      undefined,
      undefined,
      async () => response(),
    );
    const pending = { ...envelope(), actionEvidenceComplete: false };
    await backend.review(pending, new ReviewAttempt("generation", 10_000));
    expect(pending.actionEvidenceComplete).toBe(false);
    expect(typeof pending.timings?.reviewerMs).toBe("number");
  });

  test("a reasoning allow without a decision escalates with the result's own outcome", async () => {
    const result = await reviewOnce(
      reasoningBackend({
        kind: "allow",
        reason: "Looks fine.",
        decisionSource: "llm-reviewer",
        reviewerOutcome: "allow",
      }),
    );
    expect(result.kind).toBe("escalate");
    expect(result.reviewerOutcome).toBe("allow");
    expect(result.reason).toBe(
      "The reasoning reviewer did not find sufficient evidence to override the System One escalation.",
    );
    expect(result.reviewerModel).toBe(REASONING_MODEL);
  });

  test("a reasoning allow with no outcome at all escalates without one", async () => {
    const result = await reviewOnce(
      reasoningBackend({ kind: "allow", reason: "Looks fine." }),
    );
    expect(result.kind).toBe("escalate");
    expect("reviewerOutcome" in result).toBe(false);
  });

  test("keeps the model a reasoning result reports", async () => {
    const result = await reviewOnce(
      reasoningBackend({
        kind: "deny",
        reason: "Denied.",
        reviewerModel: "anthropic/other-model",
      }),
    );
    expect(result.kind).toBe("deny");
    expect(result.reviewerModel).toBe("anthropic/other-model");
    expect(result.reviewerEscalatedFrom).toEqual({
      model: "opencode/jev-1.13-free",
      reason: "System One explicitly requested a reasoning or human review.",
      trigger: "jev-escalate",
    });
  });

  test("a reasoning failure keeps Jev's scores and names the reasoning reviewer", async () => {
    const backend = new SystemOneReviewerBackend(
      config,
      async () => {
        throw new Error("synthetic reasoning failure");
      },
      REASONING_MODEL,
      async () =>
        response({
          outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
        }),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("escalate");
    expect(result.decisionSource).toBe("failure-safe");
    expect(result.reason).toContain("reasoning reviewer");
    expect(result.reviewerModel).toBe(REASONING_MODEL);
    expect(result.reviewerEscalatedFrom?.model).toBe("opencode/jev-1.13-free");
    expect(result.systemOne?.outcome.choice).toBe("escalate");
  });

  test("skips reasoning without an escalation model", async () => {
    let escalations = 0;
    const backend = new SystemOneReviewerBackend(
      config,
      async () => {
        escalations++;
        return { kind: "allow", reason: "unexpected" };
      },
      undefined,
      async () =>
        response({
          outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
        }),
    );
    const result = await reviewOnce(backend);
    expect(escalations).toBe(0);
    expect(result.decisionSource).toBe("system-one-reviewer");
    expect(result.reviewerModel).toBe("opencode/jev-1.13-free");
    expect(result.reviewerEscalatedFrom).toBeUndefined();
  });
});

const BUDGET_CASES: {
  title: string;
  config: ReviewerConfig;
  jev: JevScript;
}[] = [
  {
    title: "a clear escalation under reasoning-first",
    config: routingConfig("reasoning-first"),
    jev: JEV_ANSWERS.clearEscalate,
  },
  {
    title: "a plausible escalation in standard mode",
    config: routingConfig("standard"),
    jev: JEV_ANSWERS.plausibleEscalate,
  },
  {
    title: "invalid output under reasoning-first",
    config: routingConfig("reasoning-first"),
    jev: "invalid",
  },
  {
    title: "a failure under reasoning-first",
    config: routingConfig("reasoning-first"),
    jev: "failure",
  },
  {
    title: "an uncertain deny under denial review",
    config: routingConfig("standard", true),
    jev: JEV_ANSWERS.uncertainDeny,
  },
];

describe("hand-off budget and attempt state", () => {
  test.each(BUDGET_CASES)(
    "$title escalates without a hand-off below the floor",
    async ({ config, jev }) => {
      const { backend, calls } = routedBackend(config, jev);
      const result = await reviewOnce(
        backend,
        attemptWithRemaining(HANDOFF_BUDGET_FLOOR_MS - 1),
      );
      expect(calls()).toBe(0);
      expect(result).toMatchObject({
        kind: "escalate",
        decisionSource: "failure-safe",
        reviewerModel: JEV_MODEL,
        resolution: "budget-exhausted",
        escalationDisposition: "manual",
      });
      expect(result.reason).toStartWith(
        "No review time left for the reasoning reviewer after ",
      );
      expect(result.reason).toContain(
        "14s of the review budget remain and a hand-off needs 15s.",
      );
      expect(result.reviewerEscalatedFrom).toBeUndefined();
    },
  );

  test.each(BUDGET_CASES)(
    "$title hands off with exactly the floor left",
    async ({ config, jev }) => {
      const { backend, calls } = routedBackend(config, jev);
      const result = await reviewOnce(
        backend,
        attemptWithRemaining(HANDOFF_BUDGET_FLOOR_MS),
      );
      expect(calls()).toBe(1);
      expect(result.kind).toBe("deny");
    },
  );

  test("a budget escalation states the cause, the time left and Jev's own reason", async () => {
    const { backend } = routedBackend(
      routingConfig("reasoning-first"),
      JEV_ANSWERS.clearEscalate,
    );
    const result = await reviewOnce(
      backend,
      attemptWithRemaining(HANDOFF_BUDGET_FLOOR_MS - 1),
    );
    expect(result.reason).toBe(
      "No review time left for the reasoning reviewer after Jev escalated: 14s of the review budget remain and a hand-off needs 15s. System One explicitly requested a reasoning or human review.",
    );
  });

  test("a reasoning result already denied by its own backend stays a denial with its resolution", async () => {
    const { backend } = routedBackend(
      routingConfig("reasoning-first"),
      JEV_ANSWERS.clearEscalate,
      async () => ({
        kind: "deny",
        reason: "reviewer backend failed (TimeoutError): synthetic",
        decisionSource: "failure-safe",
        escalationDisposition: "deny",
      }),
    );
    const result = await reviewOnce(backend);
    expect(result).toMatchObject({
      kind: "deny",
      resolution: "reasoning-unavailable",
      escalationDisposition: "deny",
    });
  });

  test("a budget escalation is denied under escalationMode deny and keeps its resolution", async () => {
    const { backend } = routedBackend(
      routingConfig("reasoning-first", false, { escalationMode: "deny" }),
      JEV_ANSWERS.clearEscalate,
    );
    const result = await reviewOnce(
      backend,
      attemptWithRemaining(HANDOFF_BUDGET_FLOOR_MS - 1),
    );
    expect(result).toMatchObject({
      kind: "deny",
      escalationDisposition: "deny",
      resolution: "budget-exhausted",
    });
  });

  test("a Jev failure with no budget left takes Jev's own failure disposition", async () => {
    const { backend } = routedBackend(
      routingConfig("reasoning-first", false, {
        riskPolicy: { onReviewerFailure: "deny" },
      }),
      "failure",
    );
    const result = await reviewOnce(
      backend,
      attemptWithRemaining(HANDOFF_BUDGET_FLOOR_MS - 1),
    );
    expect(result).toMatchObject({
      kind: "deny",
      escalationDisposition: "deny",
      resolution: "budget-exhausted",
    });
  });

  test("a review that ended while Jev ran never hands off", async () => {
    const attempt = new ReviewAttempt("generation", 60_000);
    let calls = 0;
    const backend = new SystemOneReviewerBackend(
      routingConfig("reasoning-first"),
      async () => {
        calls++;
        return REASONING_DENY;
      },
      REASONING_MODEL,
      async () => {
        attempt.close("cancelled");
        return response(JEV_ANSWERS.clearEscalate);
      },
    );
    const result = await reviewOnce(backend, attempt);
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      kind: "escalate",
      decisionSource: "failure-safe",
      resolution: "reviewer",
    });
    expect(result.reason).toContain("System One reviewer failed");
  });

  test("a reasoning approval that returns after the review was superseded is never applied", async () => {
    const config = routingConfig("reasoning-first");
    const attempt = new ReviewAttempt("generation", 60_000);
    const { backend } = routedBackend(
      config,
      JEV_ANSWERS.clearEscalate,
      async () => {
        attempt.close("cancelled");
        return reasoningAllow("sufficient");
      },
    );
    const pending = envelope();
    const result = await evaluateReview(pending.request, config, {
      collect: async () => pending,
      review: (value: ReviewEnvelope) => backend.review(value, attempt),
      active: () => attempt.active(),
      auxiliarySession: () => false,
      observe: () => {},
    });
    expect(result.decisionSource).toBe("manual-superseded");
    expect(result.kind).toBe("escalate");
  });

  test.each([
    {
      title: "an uncertain deny the reasoning reviewer escalates",
      jev: JEV_ANSWERS.uncertainDeny,
      reasoning: REASONING_ESCALATE,
    },
    {
      title: "a Jev failure the reasoning reviewer cannot finish",
      jev: "failure" as const,
      reasoning: REASONING_UNAVAILABLE,
    },
  ])("$title hands off once", async ({ jev, reasoning }) => {
    const { backend, calls } = routedBackend(
      routingConfig("reasoning-first", true),
      jev,
      async () => reasoning,
    );
    const result = await reviewOnce(backend);
    expect(calls()).toBe(1);
    expect(result.kind).toBe("escalate");
  });
});

const STANDARD_REVIEWS: { title: string; jev: JevScript }[] = [
  { title: "a clean allow", jev: JEV_ANSWERS.cleanAllow },
  { title: "a clean deny", jev: JEV_ANSWERS.cleanDeny },
  { title: "a clear escalation", jev: JEV_ANSWERS.clearEscalate },
  { title: "invalid output", jev: "invalid" },
];

describe("the hand-off floor applies only to hand-offs", () => {
  test.each(STANDARD_REVIEWS)(
    "standard mode finishes $title below the floor as it does on a full budget",
    async ({ jev }) => {
      const full = routedBackend(routingConfig("standard"), jev);
      const expected = await reviewOnce(full.backend);
      const short = routedBackend(routingConfig("standard"), jev);
      const result = await reviewOnce(
        short.backend,
        attemptWithRemaining(HANDOFF_BUDGET_FLOOR_MS - 1),
      );
      expect(short.calls()).toBe(0);
      expect(result.resolution).not.toBe("budget-exhausted");
      expect({
        kind: result.kind,
        decisionSource: result.decisionSource,
        escalationDisposition: result.escalationDisposition,
        resolution: result.resolution,
      }).toEqual({
        kind: expected.kind,
        decisionSource: expected.decisionSource,
        escalationDisposition: expected.escalationDisposition,
        resolution: expected.resolution,
      });
    },
  );
});
