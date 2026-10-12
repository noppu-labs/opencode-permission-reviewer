// The V2 `permission.evaluate` hook: only an `ask` is reviewed; it is denied
// while the reviewer shuts down or has lost the host event stream, denied and
// audited at the concurrency limit of reviews, and otherwise awaited until its
// review ends.
import { randomUUID } from "node:crypto";
import type { PermissionEvaluation } from "@opencode/plugin/promise/permission";
import type { ReviewAuditRecord } from "../../audit-record.ts";
import { reviewBudgetMs } from "../../config.ts";
import { ReviewAttempt } from "../../core/review-attempt.ts";
import type { AuditScope } from "./server-audit.ts";
import { runReview } from "./server-review-run.ts";
import type { PendingReview } from "./server-state.ts";
import { notify, type ServerRuntime } from "./server-status.ts";

const MAX_PENDING_REVIEWS = 32;

/** Denies the evaluation when no review can enforce it; true when denied. */
function refusedUnavailable(
  server: ServerRuntime,
  input: PermissionEvaluation,
): boolean {
  if (!server.disposed && server.eventStreamHealthy) return false;
  input.effect = "deny";
  input.message = server.disposed
    ? "Reviewer is shutting down"
    : "Reviewer host event connection is unavailable";
  return true;
}

function overloadAuditRecord(
  scope: AuditScope,
  input: PermissionEvaluation,
  reviewID: string,
): ReviewAuditRecord {
  return {
    schemaVersion: 3,
    reviewID,
    requestID: reviewID,
    hostGeneration: "v2",
    hostVersion: scope.ctx.app.version,
    generation: scope.generation,
    directory: scope.directory,
    sessionID: input.sessionID,
    nativeAction: input.action,
    permission: input.action,
    outcome: "deny",
    reason: "Reviewer concurrency limit reached",
    timestamp: new Date().toISOString(),
    durationMs: 0,
    application: "evaluation-returned",
    decisionSource: "failure-safe",
  };
}

function refuseOverload(
  server: ServerRuntime,
  input: PermissionEvaluation,
): void {
  const reviewID = randomUUID();
  input.effect = "deny";
  input.message = "Reviewer concurrency limit reached";
  const audit = server.audit;
  if (audit)
    notify(server, () => audit(overloadAuditRecord(server, input, reviewID)));
}

function startReview(
  server: ServerRuntime,
  input: PermissionEvaluation,
): Promise<void> {
  const budget = reviewBudgetMs(server.config);
  const attempt = new ReviewAttempt(server.generation, budget);
  const pending: PendingReview = { attempt, sessionID: input.sessionID };
  server.requests.set(attempt.id, pending);
  const work = runReview(server, { input, attempt, budget }).finally(() => {
    attempt.close("cancelled");
    server.requests.delete(attempt.id);
  });
  pending.work = work;
  return work;
}

async function evaluatePermission(
  server: ServerRuntime,
  input: PermissionEvaluation,
): Promise<void> {
  if (input.effect !== "ask") return;
  if (refusedUnavailable(server, input)) return;
  if (server.requests.size >= MAX_PENDING_REVIEWS) {
    refuseOverload(server, input);
    return;
  }
  await startReview(server, input);
}

export async function registerPermissionHook(
  server: ServerRuntime,
): Promise<void> {
  server.registrations.push(
    await server.ctx.permission.hook("evaluate", (input) =>
      evaluatePermission(server, input),
    ),
  );
}
