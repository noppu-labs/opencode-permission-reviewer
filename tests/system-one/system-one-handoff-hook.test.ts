import { describe, expect, test } from "bun:test";
import { ReviewAttempt } from "../../src/core/review-attempt.ts";
import {
  type HandoffInfo,
  type OnHandoff,
  SystemOneReviewerBackend,
} from "../../src/system-one/backend.ts";
import type { ReviewExecutionResult, ReviewerConfig } from "../../src/types.ts";
import { config } from "../helpers.ts";
import { choice, envelope, response } from "./system-one-fixtures.ts";

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
): Promise<ReviewExecutionResult> {
  return target.review(
    envelope(),
    new ReviewAttempt("generation", 60_000),
    undefined,
    onHandoff,
  );
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
});
