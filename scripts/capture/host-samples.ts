import { formatFailureReason } from "../../src/failure-reason.ts";
import { HANDOFF_BUDGET_FLOOR_MS } from "../../src/system-one/system-one-handoff.ts";
import type { ReviewUiStatus } from "../../src/ui-protocol.ts";
import { handoffStatus, jevStatus } from "./fixtures.ts";

const PUSH = "git push --force-with-lease origin release/2.4";
const PUSH_REASON = "The force-push would rewrite a shared branch.";

/** The reason the server records when the reasoning reviewer throws
 *  (`reasoningFailureResult`). */
function reasoningTimeout(): string {
  const error = Object.assign(new Error("No answer within 120s"), {
    name: "TimeoutError",
  });
  return formatFailureReason("reasoning reviewer", error);
}

/** The reason of `budgetExhaustedResult` (src/system-one/system-one-budget.ts)
 *  after Jev escalated with 9s of the budget left. */
function budgetReason(): string {
  const needed = HANDOFF_BUDGET_FLOOR_MS / 1000;
  return `No review time left for the reasoning reviewer after Jev escalated: 9s of the review budget remain and a hand-off needs ${needed}s. ${PUSH_REASON}`;
}

/** Manual statuses as the server publishes them, one per resolution:
 *  `finalStatus` (src/opencode/v2/server-review-outcome.ts) with the result's
 *  hand-off, resolution and escalation disposition, and `decidedBy` only when
 *  a reviewer model produced the escalation. */
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
          decidedBy: "openai/gpt-6-luna",
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
      "budget-exhausted, as the V1 host shows it",
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
          decidedBy: "typesafe-ai/jev-1.13.0",
        },
      }),
    ],
  ];
}
