// The end of a V2 review: the failure-safe overrides for a changed or
// cancelled action, the permission effect the hook returns, and the UI status
// and audit record queued after it.
import { isSystemOneReviewerModel } from "../../reviewer-model.ts";
import type { PermissionRequest, ReviewExecutionResult } from "../../types.ts";
import { createUiStatus, type ReviewUiStatus } from "../../ui-protocol.ts";
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

function finalVariant(
  config: ServerState["config"],
  result: ReviewExecutionResult,
): string {
  if (result.reviewerModel && result.reviewerModel !== config.model)
    return config.escalationReviewer?.variant ?? config.variant;
  return isSystemOneReviewerModel(config.model) ? "system-one" : config.variant;
}

function finalStatus(
  server: ServerRuntime,
  request: PermissionRequest,
  result: ReviewExecutionResult,
  budget: number,
): ReviewUiStatus {
  return createUiStatus(request, finalPhase(result.kind), {
    model: result.reviewerModel ?? server.config.model,
    variant: finalVariant(server.config, result),
    timeoutMs: budget,
    reason: result.reason,
    ...(result.decision ? { decision: result.decision } : {}),
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
