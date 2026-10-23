// Review audit writing for the coordinator: the audit writer and the attempt-registration invariant message.

import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import { invariant } from "../../../utils/invariant.ts";
import type { CoordinatorState } from "../../review/services/coordinator-state.ts";
import {
  type AuditRecordScope,
  buildReviewAuditRecord,
} from "./review-audit-record.ts";

/** `ReviewCoordinator.process()` registers the attempt before its first await
 *  and deletes it only in its finally block, after closing it; `handle()`
 *  runs one `process()` per request ID. Every lookup asserted with this
 *  message runs inside that window. */
export const ATTEMPT_REGISTERED =
  "process() keeps the review attempt registered until it returns";

/** `scope` must be the live coordinator state: the supersede check reads
 *  `stopped` and `resolvedManually` when the record is built. */
export async function writeReviewAudit(
  scope: AuditRecordScope & Pick<CoordinatorState, "attempts" | "log">,
  request: PermissionRequest,
  result: ReviewExecutionResult,
  startedAt: number,
): Promise<void> {
  if (!scope.ctx.writeAudit) return;
  const attempt = scope.attempts.get(request.id);
  invariant(attempt, ATTEMPT_REGISTERED);
  const record = buildReviewAuditRecord(
    scope,
    attempt,
    request,
    result,
    startedAt,
  );
  await scope.ctx.writeAudit(record).catch((error) => {
    scope.log("failed to write review audit", {
      requestID: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
