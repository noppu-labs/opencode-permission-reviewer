import { describe, expect, test } from "bun:test";
import type { OpenCodeClient } from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import { ReviewAttempt } from "../../src/core/review-attempt.ts";
import { createV2ReviewerBackend } from "../../src/opencode/v2/backend-factory.ts";
import {
  type HandoffInfo,
  type OnHandoff,
  SystemOneReviewerBackend,
} from "../../src/system-one/backend.ts";
import { HANDOFF_BUDGET_FLOOR_MS } from "../../src/system-one/system-one-handoff.ts";
import type { ReviewExecutionResult, ReviewerConfig } from "../../src/types.ts";
import { config } from "../helpers.ts";
import {
  attemptWithRemaining,
  choice,
  envelope,
  response,
} from "./system-one-fixtures.ts";

const JEV = "opencode/jev-1.13-free";
const LUNA = "openai/gpt-6-luna";
const DENIED: ReviewExecutionResult = {
  kind: "deny",
  reason: "Reasoning reviewer denied the action.",
  decisionSource: "llm-reviewer",
};

function reasoningFirst(): ReviewerConfig {
  return config({
    model: JEV,
    escalationReviewer: {
      model: LUNA,
      variant: "high",
      outputFormat: "json_schema",
      timeoutMs: 120_000,
    },
    systemOneEscalation: "reasoning-first",
  });
}

function backend(
  answer: () => Promise<unknown>,
  reasoning: () => Promise<ReviewExecutionResult> = async () => DENIED,
): SystemOneReviewerBackend {
  return new SystemOneReviewerBackend(
    reasoningFirst(),
    reasoning,
    LUNA,
    answer,
  );
}

function run(
  target: SystemOneReviewerBackend,
  onHandoff: OnHandoff,
  attempt: ReviewAttempt = new ReviewAttempt("generation", 60_000),
): Promise<ReviewExecutionResult> {
  return target.review(envelope(), attempt, undefined, onHandoff);
}

const escalating = async (): Promise<unknown> =>
  response({ outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6) });

describe("System One hand-off hook", () => {
  test("announces the hand-off once, before the reasoning reviewer runs", async () => {
    const order: string[] = [];
    const handoffs: HandoffInfo[] = [];
    const target = backend(escalating, async () => {
      order.push("reasoning");
      return DENIED;
    });
    await run(target, (handoff) => {
      order.push("hook");
      handoffs.push(handoff);
    });
    expect(order).toEqual(["hook", "reasoning"]);
    expect(handoffs).toEqual([
      { from: JEV, to: LUNA, trigger: "jev-escalate" },
    ]);
  });

  test("stays silent when Jev decides alone", async () => {
    const handoffs: HandoffInfo[] = [];
    await run(
      backend(async () => response()),
      (handoff) => {
        handoffs.push(handoff);
      },
    );
    expect(handoffs).toEqual([]);
  });

  test("names the failure kind when Jev fails", async () => {
    const timeout = new Error("The operation timed out.");
    timeout.name = "TimeoutError";
    const handoffs: HandoffInfo[] = [];
    await run(
      backend(async () => {
        throw timeout;
      }),
      (handoff) => {
        handoffs.push(handoff);
      },
    );
    expect(handoffs).toEqual([
      { from: JEV, to: LUNA, trigger: "jev-failure", failureKind: "timeout" },
    ]);
  });

  test("a throwing hook never changes the review's outcome", async () => {
    let reasoningRuns = 0;
    const result = await run(
      backend(escalating, async () => {
        reasoningRuns++;
        return DENIED;
      }),
      () => {
        throw new Error("status publish failed");
      },
    );
    expect(reasoningRuns).toBe(1);
    expect(result).toMatchObject({ kind: "deny", reviewerModel: LUNA });
  });

  describe("stays silent without a hand-off", () => {
    async function silent(
      attempt: ReviewAttempt,
      target?: SystemOneReviewerBackend,
    ): Promise<{ handoffs: HandoffInfo[]; reasoningRuns: number }> {
      const handoffs: HandoffInfo[] = [];
      let reasoningRuns = 0;
      await run(
        target ??
          backend(escalating, async () => {
            reasoningRuns++;
            return DENIED;
          }),
        (handoff) => {
          handoffs.push(handoff);
        },
        attempt,
      );
      attempt.close("finished");
      return { handoffs, reasoningRuns };
    }

    test("when the attempt is no longer active", async () => {
      const attempt = new ReviewAttempt("generation", 60_000);
      attempt.close("cancelled");
      expect(await silent(attempt)).toEqual({ handoffs: [], reasoningRuns: 0 });
    });

    test("when less than the hand-off budget floor remains", async () => {
      const attempt = attemptWithRemaining(HANDOFF_BUDGET_FLOOR_MS - 1);
      expect(await silent(attempt)).toEqual({ handoffs: [], reasoningRuns: 0 });
    });

    test("when no reasoning reviewer is configured", async () => {
      const unconfigured = new SystemOneReviewerBackend(
        reasoningFirst(),
        undefined,
        undefined,
        escalating,
      );
      const { handoffs } = await silent(
        new ReviewAttempt("generation", 60_000),
        unconfigured,
      );
      expect(handoffs).toEqual([]);
    });
  });
});

describe("the V2 backend factory", () => {
  test("forwards the hook to the System One backend", async () => {
    const saved = process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    const handoffs: HandoffInfo[] = [];
    const target = createV2ReviewerBackend(
      {} as Parameters<Plugin.Plugin["setup"]>[0],
      reasoningFirst(),
    );
    try {
      await target.review(
        envelope(),
        new ReviewAttempt("generation", 60_000),
        {} as OpenCodeClient,
        (handoff) => {
          handoffs.push(handoff);
        },
      );
    } finally {
      await target.dispose();
      if (saved === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = saved;
    }
    expect(handoffs).toMatchObject([
      { from: JEV, to: LUNA, trigger: "jev-failure" },
    ]);
  });
});
