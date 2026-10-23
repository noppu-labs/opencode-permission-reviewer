import { resolveConfig } from "../../src/modules/config/services/config.ts";
import { formatFailureReason } from "../../src/modules/decision/failure-reason.ts";
import { budgetExhaustedResult } from "../../src/modules/reviewer/services/system-one-budget.ts";
import type { ReviewUiStatus } from "../../src/modules/status/models/ui-protocol.ts";
import { handoffStatus, JEV, jevStatus, LUNA } from "./fixtures.ts";
import { PUSH } from "./samples.ts";

const PUSH_REASON = "The force-push would rewrite a shared branch.";

/** The reason the server records when the reasoning reviewer throws
 *  (`reasoningFailureResult`). */
function reasoningTimeout(): string {
  const error = Object.assign(new Error("No answer within 120s"), {
    name: "TimeoutError",
  });
  return formatFailureReason("reasoning reviewer", error);
}

/** The reason of `budgetExhaustedResult` (src/modules/reviewer/services/system-one-budget.ts)
 *  after Jev escalated with 9s of the budget left. */
function budgetReason(): string {
  const own = {
    result: {
      kind: "escalate" as const,
      reason: PUSH_REASON,
      decisionSource: "system-one-reviewer" as const,
    },
    category: "general" as const,
  };
  return budgetExhaustedResult(
    own,
    "jev-escalate",
    9_000,
    resolveConfig({ model: JEV }),
  ).reason;
}

/** Shaped as the server publishes them (`decidedByField`): `decidedBy` only
 *  when a reviewer model produced the escalation, so the failure-safe
 *  resolutions carry none. */
export function manualSamples(): Array<[string, ReviewUiStatus]> {
  return [
    [
      "reasoning-escalated",
      handoffStatus("jev-escalate", {
        command: PUSH,
        phase: "manual",
        reason: PUSH_REASON,
        extra: {
          resolution: "reasoning-escalated",
          escalationDisposition: "manual",
          decidedBy: LUNA,
        },
      }),
    ],
    [
      "reasoning-unavailable",
      handoffStatus("jev-escalate", {
        command: PUSH,
        phase: "manual",
        reason: reasoningTimeout(),
        extra: {
          resolution: "reasoning-unavailable",
          escalationDisposition: "manual",
        },
      }),
    ],
    [
      "budget-exhausted",
      jevStatus({
        command: PUSH,
        phase: "manual",
        reason: budgetReason(),
        extra: {
          resolution: "budget-exhausted",
          escalationDisposition: "manual",
        },
      }),
    ],
    [
      "reviewer (no hand-off)",
      jevStatus({
        command: PUSH,
        phase: "manual",
        reason: "Jev could not tell whether the user wanted a force-push.",
        extra: {
          resolution: "reviewer",
          escalationDisposition: "manual",
          decidedBy: JEV,
        },
      }),
    ],
  ];
}
