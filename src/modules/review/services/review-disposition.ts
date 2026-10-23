// The side-effect boundary after logical disposition: the permission reply and
// the terminal UI phase for an allow, a deny or an escalation, honoring
// supersede before each step, and the failure-safe disposition and log of a
// review that threw.

import type {
  PermissionRequest,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../../types.ts";
import {
  type CoordinatorState,
  isSuperseded,
  supersedeResult,
} from "./coordinator-state.ts";
import { applyEscalationDisposition } from "./decision/escalation.ts";
import { formatFailureReason } from "./decision/failure-reason.ts";
import type { ReviewAttempt } from "./review-attempt.ts";
import { sendPermissionReply } from "./review-reply.ts";
import { publishReviewStatus } from "./review-status.ts";

/**
 * Reject a request with `reject` while honoring supersede. Returns `undefined`
 * when the rejection was applied, or the supersede result when the request had
 * already been answered manually (so the caller returns it unchanged).
 */
async function denyAndReply(
  state: CoordinatorState,
  request: PermissionRequest,
  result: ReviewExecutionResult,
): Promise<ReviewExecutionResult | undefined> {
  if (isSuperseded(state, request)) return supersedeResult();
  const accepted = await sendPermissionReply(
    state,
    request,
    "reject",
    result.reason,
  );
  if (!accepted) return supersedeResult();
  // Publish the terminal phase only after OpenCode accepted the reply: the
  // UI must not claim a denial that the server never recorded.
  await publishReviewStatus(state, request, "denied", result);
  return undefined;
}

export async function applyDisposition(
  state: CoordinatorState,
  request: PermissionRequest,
  result: ReviewExecutionResult,
): Promise<ReviewExecutionResult> {
  if (isSuperseded(state, request)) return supersedeResult();

  if (result.kind === "allow") {
    const accepted = await sendPermissionReply(state, request, "once");
    if (!accepted) return supersedeResult();
    // Publish the terminal phase only after OpenCode accepted the reply: the
    // UI must not claim an approval that the server never recorded.
    await publishReviewStatus(state, request, "approved", result);
    return result;
  }

  if (result.kind === "deny")
    return (await denyAndReply(state, request, result)) ?? result;

  // Escalate → leave for human. Do not reply.
  if (isSuperseded(state, request)) return supersedeResult();
  await publishReviewStatus(state, request, "manual", result);
  state.log("review escalated to user", {
    requestID: request.id,
    reason: result.reason,
  });
  return result;
}

export function failureDisposition(
  config: ReviewerConfig,
  error: unknown,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason: formatFailureReason("review coordination", error),
      decisionSource: "failure-safe",
    },
    config,
    "general",
  );
}

/** Not async: returns the chosen step's own promise (the unknown phase when
 *  the reply's fate is unknown or the attempt ended, else the full
 *  disposition), so the caller awaits it directly. */
export function applyFailureDisposition(
  state: CoordinatorState,
  attempt: ReviewAttempt,
  request: PermissionRequest,
  disposed: ReviewExecutionResult,
): Promise<unknown> {
  return attempt.application === "unknown" || !attempt.active()
    ? publishReviewStatus(state, request, "unknown", {
        reason: disposed.reason,
      })
    : applyDisposition(state, request, disposed);
}

export function logReviewFailure(
  state: Pick<CoordinatorState, "log">,
  request: PermissionRequest,
  error: unknown,
): void {
  state.log("review failed; the attempt recorded its failure disposition", {
    requestID: request.id,
    error: error instanceof Error ? error.message : String(error),
  });
}
