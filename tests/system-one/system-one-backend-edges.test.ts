import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../../src/config.ts";
import { ReviewAttempt } from "../../src/core/review-attempt.ts";
import { DEFAULT_TENANT_POLICY } from "../../src/policy.ts";
import { SystemOneReviewerBackend } from "../../src/system-one/backend.ts";
import type { SystemOneState } from "../../src/system-one/review.ts";
import type { ReviewExecutionResult } from "../../src/types.ts";
import { GITHUB_PAT_ALPHANUMERIC } from "../fixtures/synthetic-secrets.ts";
import {
  choice,
  envelope,
  response,
  reviewOnce,
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
