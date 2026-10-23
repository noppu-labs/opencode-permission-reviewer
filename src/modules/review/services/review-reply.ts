// The review's own permission reply: bounded, timed into the attempt, and
// treated as superseded when the host says the request was already resolved.
import {
  isAlreadyResolvedError,
  withTimeout,
} from "../../../adapters/opencode/transport.ts";
import type { PermissionRequest } from "../../../types.ts";
import { rememberEvidence } from "./attempt-evidence.ts";
import type { CoordinatorState } from "./coordinator-state.ts";

type ReplyScope = Pick<
  CoordinatorState,
  "ctx" | "attempts" | "resolvedManually" | "log" | "metadataCallTimeoutMs"
>;

/**
 * Send a permission reply. Returns `true` on success, `false` when the
 * request was already resolved by another source (human TUI, a duplicate
 * event, etc.) so the caller can treat itself as superseded. Other errors
 * (transport failure, malformed reply) are still thrown.
 */
export async function sendPermissionReply(
  scope: ReplyScope,
  request: PermissionRequest,
  reply: "once" | "reject",
  message?: string,
): Promise<boolean> {
  const replyStart = performance.now();
  const attempt = scope.attempts.get(request.id);
  if (!attempt?.active()) return false;
  attempt.application = "unknown";
  const response = await withTimeout(
    scope.ctx.permissionReply({
      path: { requestID: request.id },
      body: {
        reply,
        ...(message === undefined
          ? {}
          : { message: `[Automatic permission review] ${message}` }),
      },
      query: { directory: scope.ctx.directory },
    }),
    scope.metadataCallTimeoutMs,
  );
  const replyMs = performance.now() - replyStart;
  const currentTimings = scope.attempts.get(request.id)?.evidence.timings ?? {};
  rememberEvidence(scope.attempts, request.id, {
    timings: { ...currentTimings, replyMs },
  });
  if (response.error !== undefined) {
    if (isAlreadyResolvedError(response.error)) {
      attempt.application = "superseded";
      scope.resolvedManually.add(request.id);
      scope.log(
        "review reply rejected because the request was already resolved",
        {
          requestID: request.id,
          error: response.error,
        },
      );
      return false;
    }
    throw new Error(
      `permission.reply failed: ${JSON.stringify(response.error)}`,
    );
  }
  attempt.application = "reply-accepted";
  return true;
}
