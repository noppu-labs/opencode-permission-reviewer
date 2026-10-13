// The routing fields a server-side UI status carries: the hand-off a host
// announces while the reasoning reviewer runs, built here for both hosts.
import { failureKind } from "./failure-kind.ts";
import type { HandoffInfo, OnHandoff } from "./system-one/backend.ts";
import type { ReasoningHandoff } from "./system-one/system-one-results.ts";
import type { HandoffTrigger } from "./types.ts";

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
