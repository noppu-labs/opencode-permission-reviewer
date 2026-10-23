// The toast a manual outcome raises: title, variant and lead sentence follow
// how the review ended, then the reason.
import { failureKind } from "../modules/status/models/failure-kind.ts";
import type { ReviewUiStatus } from "../modules/status/models/ui-protocol.ts";
import { handoffCause, modelLabel, shortModelName } from "./attribution.ts";

export interface ManualToast {
  variant: "warning" | "error";
  title: string;
  message: string;
}

const NO_TIME_LEAD = "No review time left for";
const GENERIC_REVIEWER = "the reasoning reviewer";
/** `budgetExhaustedResult`'s reason (`src/modules/reviewer/services/system-one-budget.ts`):
 *  "<lead> after <cause>: <budget sentence> <Jev reason>". */
const BUDGET_REASON =
  /^No review time left for the reasoning reviewer after (.+?): ([\s\S]*)$/;

const warning = (message: string): ManualToast => ({
  variant: "warning",
  title: "Manual review required",
  message,
});

const withReason = (lead: string, reason: string | undefined): string =>
  reason ? `${lead} ${reason}` : lead;

/** Without a hand-off, `status.model` is the reasoning reviewer on these
 *  resolutions. */
const reasoningModel = (status: ReviewUiStatus): string =>
  modelLabel(status.handoff?.to ?? status.model);

function unavailable(status: ReviewUiStatus): ManualToast {
  const kind = failureKind(status.reason ?? "");
  const failed = kind === undefined ? "failed" : `failed (${kind})`;
  return {
    variant: "error",
    title: "Reasoning reviewer unavailable",
    message: withReason(
      `${reasoningModel(status)} ${failed}. This permission needs your approval.`,
      status.reason,
    ),
  };
}

/** The engine's reason repeats the lead, so it is reshaped rather than
 *  appended to. */
function noTimeLeft(
  status: ReviewUiStatus,
  reviewer: string | undefined,
): string {
  const { handoff, reason } = status;
  const parts = reason === undefined ? null : BUDGET_REASON.exec(reason);
  if (handoff !== undefined)
    return withReason(
      `${NO_TIME_LEAD} ${shortModelName(handoff.to) || GENERIC_REVIEWER} after Jev (${handoffCause(handoff)}).`,
      parts === null ? reason : parts[2],
    );
  if (reason === undefined)
    return `${NO_TIME_LEAD} ${GENERIC_REVIEWER} after Jev.`;
  if (parts === null) return reason;
  const name = shortModelName(reviewer ?? "") || GENERIC_REVIEWER;
  return `${NO_TIME_LEAD} ${name} after Jev (${parts[1]}). ${parts[2]}`;
}

/** `fallback` stands in for a missing reason on a `reasoning-escalated` or
 *  plain manual toast; `reasoningReviewer` names the configured reasoning
 *  model for a review that ran out of time before the hand-off. */
export function manualToast(
  status: ReviewUiStatus,
  fallback: string,
  reasoningReviewer?: string,
): ManualToast {
  switch (status.resolution) {
    case "reasoning-escalated":
      return warning(
        `${reasoningModel(status)} reviewed this after Jev; it needs your approval: ${status.reason ?? fallback}`,
      );
    case "reasoning-unavailable":
      return unavailable(status);
    case "budget-exhausted":
      return warning(noTimeLeft(status, reasoningReviewer));
    default:
      return warning(status.reason ?? fallback);
  }
}
