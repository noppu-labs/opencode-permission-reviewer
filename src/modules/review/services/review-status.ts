// Best-effort publishing of the reviewer's UI status: the status a phase shows
// (model, variant, outcome, actor) and the bounded, logged publish call.

import { withTimeout } from "../../../adapters/opencode/transport.ts";
import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { reviewBudgetMs } from "../../config/services/config.ts";
import type { HandoffInfo } from "../../reviewer/services/backend.ts";
import { isSystemOneReviewerModel } from "../../reviewer/services/reviewer-model.ts";
import type { ReviewUiStatus } from "../../status/models/ui-protocol.ts";
import { createServerUiStatus } from "../../status/services/ui-action-segments.ts";
import {
  configNoticeFields,
  decidedByField,
  statusRouting,
} from "../../status/services/ui-status-routing.ts";
import type { CoordinatorState } from "./coordinator-state.ts";

type StatusScope = Pick<
  CoordinatorState,
  "ctx" | "config" | "attempts" | "log" | "metadataCallTimeoutMs"
>;

/** The outcome fields a phase can show; a result carries all of them but the
 *  hand-off, which the "reviewing" status during a hand-off sets. */
export type StatusDetails = Partial<
  Pick<
    ReviewExecutionResult,
    | "reason"
    | "decision"
    | "escalationDisposition"
    | "reviewerModel"
    | "reviewerEscalatedFrom"
    | "resolution"
    | "decisionSource"
  >
> & { handoff?: HandoffInfo };

/** The reviewer variant to show: the escalation reviewer's when another model
 *  decided, System One's label for a System One model, else the configured one. */
function statusVariant(
  config: ReviewerConfig,
  reviewerModel: string | undefined,
): string {
  if (reviewerModel && reviewerModel !== config.model)
    return config.escalationReviewer?.variant ?? config.variant;
  return isSystemOneReviewerModel(config.model) ? "system-one" : config.variant;
}

function statusFor(
  scope: StatusScope,
  request: PermissionRequest,
  phase: ReviewUiStatus["phase"],
  details: StatusDetails,
): ReviewUiStatus {
  const { reason, decision, reviewerModel } = details;
  const actor = scope.attempts.get(request.id)?.evidence.actor;
  return createServerUiStatus(request, phase, {
    model: reviewerModel ?? scope.config.model,
    variant: statusVariant(scope.config, reviewerModel),
    timeoutMs: reviewBudgetMs(scope.config),
    ...(reason === undefined ? {} : { reason }),
    ...(decision === undefined ? {} : { decision }),
    ...statusRouting(details, scope.config),
    ...decidedByField(details, scope.config),
    ...configNoticeFields(scope.config),
    ...(actor?.agentName.value === undefined
      ? {}
      : { actorName: actor.agentName.value }),
    ...(actor === undefined ? {} : { actorProfile: actor.profile.value }),
  });
}

function publishError(response: unknown): response is { error: unknown } {
  return (
    !!response &&
    typeof response === "object" &&
    "error" in response &&
    (response as { error?: unknown }).error !== undefined
  );
}

export async function publishReviewStatus(
  scope: StatusScope,
  request: PermissionRequest,
  phase: ReviewUiStatus["phase"],
  details: StatusDetails = {},
): Promise<void> {
  if (!scope.ctx.publishUiStatus) return;
  const status = statusFor(scope, request, phase, details);
  // Status publishing is best-effort: a TUI failure must not fail the review,
  // and a hung publish must not stall the review pipeline either.
  try {
    const response = await withTimeout(
      scope.ctx.publishUiStatus(status),
      Math.min(scope.metadataCallTimeoutMs, 5_000),
    );
    // Both publish paths resolve with `{ data, error }`; a failure arrives as
    // an `error` field rather than a rejection (the raw fallback can reject
    // too, caught below).
    if (publishError(response)) {
      scope.log("failed to publish reviewer UI status", {
        requestID: request.id,
        phase,
        error: JSON.stringify(response.error),
      });
    }
  } catch (error) {
    scope.log("failed to publish reviewer UI status", {
      requestID: request.id,
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The hook is synchronous, so the publish is not awaited. The `catch` drops a
 *  status `statusFor` cannot build: `publishReviewStatus` only catches the
 *  publish itself. */
export function publishHandoffStatus(
  scope: StatusScope,
  request: PermissionRequest,
  handoff: HandoffInfo,
): void {
  publishReviewStatus(scope, request, "reviewing", {
    reviewerModel: handoff.to,
    handoff,
  }).catch(() => {});
}
