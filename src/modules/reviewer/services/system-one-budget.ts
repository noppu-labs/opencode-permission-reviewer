import type {
  HandoffTrigger,
  ReviewExecutionResult,
} from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { HANDOFF_BUDGET_FLOOR_MS } from "../../config/services/system-one-routing.ts";
import { applyEscalationDisposition } from "../../decision/escalation.ts";
import type { JevResult } from "./system-one-results.ts";

const TRIGGER_CAUSE: Record<HandoffTrigger, string> = {
  "jev-escalate": "System One escalated",
  "jev-uncertain-allow": "System One's approval was uncertain",
  "jev-gate": "a safety gate stopped System One's approval",
  "jev-invalid": "System One's response was invalid",
  "jev-failure": "System One failed",
  "jev-uncertain-deny": "System One's denial was uncertain",
};

/** The escalation when a hand-off is due but the attempt has too little time
 *  left. No reasoning review ran, so Jev's own disposition applies. */
export function budgetExhaustedResult(
  own: JevResult,
  trigger: HandoffTrigger,
  remainingMs: number,
  config: ReviewerConfig,
): ReviewExecutionResult {
  const left = Math.floor(remainingMs / 1000);
  const needed = HANDOFF_BUDGET_FLOOR_MS / 1000;
  return applyEscalationDisposition(
    {
      ...own.result,
      kind: "escalate",
      reason: `No review time left for the reasoning reviewer after ${TRIGGER_CAUSE[trigger]}: ${left}s of the review budget remain and a hand-off needs ${needed}s. ${own.result.reason}`,
      decisionSource: "failure-safe",
      resolution: "budget-exhausted",
    },
    config,
    own.category,
  );
}
