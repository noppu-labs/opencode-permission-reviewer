// UI status fields shared by the V1 coordinator and the V2 server; not shipped
// in the TUI package (`scripts/copy-tui.ts`).

import type {
  HandoffInfo,
  HandoffTrigger,
  OnHandoff,
  ReasoningHandoff,
  ReviewExecutionResult,
} from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { failureKind } from "../models/failure-kind.ts";
import type { UiStatusOptions } from "../models/ui-protocol.ts";

/** The hand-off to show; a `jev-failure` one names the failure kind its
 *  reason records. */
export function handoffInfo(
  from: string,
  to: string,
  trigger: HandoffTrigger,
  reason: string,
): HandoffInfo {
  const kind = trigger === "jev-failure" ? failureKind(reason) : undefined;
  return {
    from,
    to,
    trigger,
    ...(kind === undefined ? {} : { failureKind: kind }),
  };
}

/** Presentation only: a throwing hook must never change the review. */
export function announceHandoff(
  onHandoff: OnHandoff | undefined,
  reasoning: ReasoningHandoff,
): void {
  if (onHandoff === undefined) return;
  const { model, reason, trigger } = reasoning.escalatedFrom;
  try {
    const pending: unknown = onHandoff(
      handoffInfo(model, reasoning.model, trigger, reason),
    );
    if (pending instanceof Promise) pending.catch(() => {});
  } catch {
    // The review goes on without the indicator.
  }
}

type RoutingDetails = Partial<
  Pick<
    ReviewExecutionResult,
    "reviewerEscalatedFrom" | "resolution" | "escalationDisposition"
  >
> & { handoff?: HandoffInfo };

/** The hand-off a result records, shown on its final status; undefined when
 *  it records no trigger or no reasoning reviewer is configured. */
export function resultHandoff(
  result: Partial<Pick<ReviewExecutionResult, "reviewerEscalatedFrom">>,
  config: Pick<ReviewerConfig, "escalationReviewer">,
): HandoffInfo | undefined {
  const from = result.reviewerEscalatedFrom;
  const to = config.escalationReviewer?.model;
  if (from?.trigger === undefined || to === undefined) return;
  return handoffInfo(from.model, to, from.trigger, from.reason);
}

/** The hand-off, resolution and escalation disposition a status shows. */
export function statusRouting(
  details: RoutingDetails,
  config: Pick<ReviewerConfig, "escalationReviewer">,
): Pick<UiStatusOptions, "handoff" | "resolution" | "escalationDisposition"> {
  const handoff = details.handoff ?? resultHandoff(details, config);
  const { resolution, escalationDisposition } = details;
  return {
    ...(handoff === undefined ? {} : { handoff }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(escalationDisposition === undefined ? {} : { escalationDisposition }),
  };
}

export function decidedByField(
  result: Partial<
    Pick<ReviewExecutionResult, "decisionSource" | "reviewerModel">
  >,
  config: Pick<ReviewerConfig, "model">,
): Pick<UiStatusOptions, "decidedBy"> {
  const { decisionSource } = result;
  if (
    decisionSource !== "system-one-reviewer" &&
    decisionSource !== "llm-reviewer"
  )
    return {};
  return { decidedBy: result.reviewerModel ?? config.model };
}

/** The config lists a v1 status carries, only when non-empty. */
export function configNoticeFields(
  config: Pick<ReviewerConfig, "configWarnings" | "configDegraded">,
): Pick<UiStatusOptions, "configWarnings" | "configDegraded"> {
  const { configWarnings = [], configDegraded = [] } = config;
  return {
    ...(configWarnings.length === 0 ? {} : { configWarnings }),
    ...(configDegraded.length === 0 ? {} : { configDegraded }),
  };
}
