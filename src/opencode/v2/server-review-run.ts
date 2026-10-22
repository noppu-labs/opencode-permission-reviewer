// One V2 permission review from the pending action to the engine's result:
// snapshot and normalise the action, verify its session and the host
// connection, then run the review engine. Any failure escalates through the
// failure-safe disposition.
import type { NormalizedReviewRequest } from "../../core/contracts.ts";
import { evaluateReview } from "../../core/review-engine.ts";
import { applyEscalationDisposition } from "../../escalation.ts";
import { formatFailureReason } from "../../failure-reason.ts";
import type { ReviewExecutionResult } from "../../types.ts";
import { createServerUiStatus } from "../../ui-action-segments.ts";
import { normalizeV2Permission } from "./permission-codec.ts";
import { exactToolInput, snapshotAction } from "./server-events.ts";
import { finishReview } from "./server-review-outcome.ts";
import { reviewPorts } from "./server-review-ports.ts";
import type { ReviewRun } from "./server-state.ts";
import { publishStatus, type ServerRuntime } from "./server-status.ts";

/** Snapshots and normalises the pending action with its exact tool input. */
function beginReview(
  server: ServerRuntime,
  run: ReviewRun,
): NormalizedReviewRequest {
  const { input } = run;
  const exact = exactToolInput(server, input);
  run.actionSnapshot = snapshotAction(server, input, exact);
  if (run.actionSnapshot.length > 1_000_000)
    throw new Error("Pending action exceeds the evidence size limit");
  const permission = normalizeV2Permission(
    input,
    {
      reviewID: run.attempt.id,
      generation: server.generation,
      directory: server.directory,
      hostVersion: server.ctx.app.version,
    },
    exact,
  );
  run.normalized = permission;
  return permission;
}

function failureSafeEscalation(
  server: ServerRuntime,
  error: unknown,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason: formatFailureReason("permission review hook", error),
      decisionSource: "failure-safe",
    },
    server.config,
    "general",
  );
}

export async function runReview(
  server: ServerRuntime,
  run: ReviewRun,
): Promise<void> {
  const { input, attempt } = run;
  let result: ReviewExecutionResult;
  try {
    const permission = beginReview(server, run);
    await publishStatus(
      server,
      createServerUiStatus(permission.request, "reviewing", {
        model: server.config.model,
        variant: server.systemOneReviewer
          ? "system-one"
          : server.config.variant,
        timeoutMs: run.budget,
      }),
    );
    const session = await attempt.wait(
      server.ctx.session.get({ sessionID: input.sessionID }),
    );
    if (session.location.directory !== server.directory)
      throw new Error("Permission belongs to another location");
    const client = await attempt
      .wait(
        server.services.connect(
          server.ctx,
          server.directory,
          server.identity,
          server.ctx.app.version,
          attempt.signal,
        ),
      )
      .catch((error: unknown) => {
        server.connectionState = "failed";
        throw error;
      });
    server.connectionState = "verified";
    result = await attempt.wait(
      evaluateReview(
        permission.request,
        server.config,
        reviewPorts(server, run, permission, client),
      ),
    );
  } catch (error) {
    result = failureSafeEscalation(server, error);
  }
  finishReview(server, run, result);
}
