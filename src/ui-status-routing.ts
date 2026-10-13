// The routing fields a server-side UI status carries: the hand-off a host
// announces while the reasoning reviewer runs, built here for both hosts.
import { failureKind } from "./failure-kind.ts";
import type { HandoffInfo, OnHandoff } from "./system-one/backend.ts";
import type { ReasoningHandoff } from "./system-one/system-one-results.ts";
import type {
  HandoffTrigger,
  ReviewExecutionResult,
  ReviewerConfig,
} from "./types.ts";
import type { UiStatusOptions } from "./ui-protocol.ts";

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

/** Tells the host Jev handed off, right before the reasoning reviewer runs.
 *  Showing it is presentation: a throwing hook never changes the review. */
export function announceHandoff(
  onHandoff: OnHandoff | undefined,
  reasoning: ReasoningHandoff,
): void {
  if (onHandoff === undefined) return;
  const { model, reason, trigger } = reasoning.escalatedFrom;
  try {
    onHandoff(handoffInfo(model, reasoning.model, trigger, reason));
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
