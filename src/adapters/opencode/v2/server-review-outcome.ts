// The end of a V2 review: the failure-safe overrides for a changed or
// cancelled action, the permission effect the hook returns, and the UI status
// and audit record queued after it.

import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewUiStatus } from "../../../modules/status/models/ui-protocol.ts";
import { createServerUiStatus } from "../../../modules/status/services/ui-action-segments.ts";
import {
  decidedByField,
  statusRouting,
} from "../../../modules/status/services/ui-status-routing.ts";
import { reviewAuditRecord } from "./server-audit.ts";
import { snapshotAction } from "./server-events.ts";
import type { ReviewRun, ServerState } from "./server-state.ts";
import { notify, publishStatus, type ServerRuntime } from "./server-status.ts";

/** A failure-safe denial that keeps the replaced result's System One scores. */
function failureSafeDeny(
  reason: string,
  result: ReviewExecutionResult,
): ReviewExecutionResult {
  return {
    kind: "deny",
    reason,
    decisionSource: "failure-safe",
    ...(result.systemOne === undefined ? {} : { systemOne: result.systemOne }),
  };
}

function revalidated(
  state: Pick<ServerState, "tools">,
  run: ReviewRun,
  result: ReviewExecutionResult,
): ReviewExecutionResult {
  try {
    if (
      run.actionSnapshot !== undefined &&
      snapshotAction(state, run.input) !== run.actionSnapshot
    )
      return failureSafeDeny(
        "Pending action changed during its review",
        result,
      );
    return result;
  } catch {
    return failureSafeDeny("Pending action could not be revalidated", result);
  }
}

function hostEffect(
  kind: ReviewExecutionResult["kind"],
): ReviewRun["input"]["effect"] {
  if (kind === "allow") return "allow";
  return kind === "deny" ? "deny" : "ask";
}

function finalPhase(
  kind: ReviewExecutionResult["kind"],
): ReviewUiStatus["phase"] {
  if (kind === "allow") return "approved";
  return kind === "deny" ? "denied" : "manual";
}

/** The variant for `reviewerModel` (the deciding model on a result, the
 *  hand-off target on a hand-off status): the escalation reviewer's when it is
 *  not the configured model. */
export function reviewerVariant(
  {
    config,
    systemOneReviewer,
  }: Pick<ServerState, "config" | "systemOneReviewer">,
  reviewerModel: string | undefined,
): string {
  if (reviewerModel && reviewerModel !== config.model)
    return config.escalationReviewer?.variant ?? config.variant;
  return systemOneReviewer ? "system-one" : config.variant;
}

function finalStatus(
  server: ServerRuntime,
  request: PermissionRequest,
  result: ReviewExecutionResult,
  budget: number,
): ReviewUiStatus {
  return createServerUiStatus(request, finalPhase(result.kind), {
    model: result.reviewerModel ?? server.config.model,
    variant: reviewerVariant(server, result.reviewerModel),
    timeoutMs: budget,
    reason: result.reason,
    ...(result.decision ? { decision: result.decision } : {}),
    ...statusRouting(result, server.config),
    ...decidedByField(result, server.config),
  });
}

function queueReport(
  server: ServerRuntime,
  run: ReviewRun,
  result: ReviewExecutionResult,
  active: boolean,
): void {
  const { normalized } = run;
  if (normalized)
    notify(server, () =>
      publishStatus(
        server,
        finalStatus(server, normalized.request, result, run.budget),
      ),
    );
  const audit = server.audit;
  if (audit)
    notify(server, () => audit(reviewAuditRecord(server, run, result, active)));
}

/** Applies the review's result to the hook's input and queues its report. */
export function finishReview(
  server: ServerRuntime,
  run: ReviewRun,
  reviewed: ReviewExecutionResult,
): void {
  let result = revalidated(server, run, reviewed);
  const active = !server.disposed && run.attempt.active(server.generation);
  if (!active)
    result = failureSafeDeny(
      "Review was cancelled or its total deadline expired",
      result,
    );
  // The hook owns this evaluation; there is no published permission ID to reply to.
  run.input.effect = hostEffect(result.kind);
  if (
    run.input.effect === "allow" &&
    run.envelope?.actionEvidenceComplete !== false
  )
    server.scriptRegistry.rememberApproved(
      run.envelope?.verifiedScript,
      result.decision,
    );
  if (run.input.effect !== "allow") run.input.message = result.reason;
  run.attempt.close("finished");
  // No awaited I/O between the terminal mutation and returning the hook.
  // Presentation and audit cannot extend the window for a stale approval.
  queueReport(server, run, result, active);
}
