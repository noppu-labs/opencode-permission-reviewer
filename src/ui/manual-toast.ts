// The toast a manual outcome raises: title, variant and lead sentence chosen
// by how the review ended, then the reason as before.
import { failureKind } from "../failure-kind.ts";
import type { ReviewUiStatus } from "../ui-protocol.ts";
import { handoffCause, shortModelName } from "./attribution.ts";

export interface ManualToast {
  variant: "warning" | "error";
  title: string;
  message: string;
}

const NO_TIME_LEAD = "No review time left for";
const GENERIC_REVIEWER = "the reasoning reviewer";
/** The engine's reason: "<lead> after <cause>: <budget sentence> <Jev reason>". */
const BUDGET_REASON =
  /^No review time left for the reasoning reviewer after (.+?): ([\s\S]*)$/;

const warning = (message: string): ManualToast => ({
  variant: "warning",
  title: "Manual review required",
  message,
});

const withReason = (lead: string, reason: string | undefined): string =>
  reason ? `${lead} ${reason}` : lead;

/** The reasoning reviewer's short name: the hand-off target, else the model
 *  the status credits (the reasoning reviewer on these resolutions). */
const reasoningModel = (status: ReviewUiStatus): string =>
  shortModelName(status.handoff?.to ?? status.model);

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
      `${NO_TIME_LEAD} ${shortModelName(handoff.to)} after Jev (${handoffCause(handoff)}).`,
      parts === null ? reason : parts[2],
    );
  if (reason === undefined)
    return `${NO_TIME_LEAD} ${GENERIC_REVIEWER} after Jev.`;
  if (parts === null) return reason;
  const name =
    reviewer === undefined ? GENERIC_REVIEWER : shortModelName(reviewer);
  return `${NO_TIME_LEAD} ${name} after Jev (${parts[1]}). ${parts[2]}`;
}

/** The manual-review toast for `status`; `fallback` stands in for a missing
 *  reason where no lead sentence already asks for approval, and
 *  `reasoningReviewer` names the configured reasoning model for a review that
 *  ran out of time before the hand-off. */
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
