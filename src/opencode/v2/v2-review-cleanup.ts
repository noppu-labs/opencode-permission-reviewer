import type { ReviewerConfig } from "../../types.ts";
import type { V2HostApi } from "./host-api.ts";
import type { PendingGeneration } from "./v2-review-pending.ts";

/** The HTTP client and the in-process plugin adapter tag a missing session
 *  differently: `SessionNotFoundError` vs `Session.NotFoundError`. */
const isSessionNotFound = (error: unknown): boolean => {
  const tag = (error as { _tag?: string })?._tag;
  return tag === "SessionNotFoundError" || tag === "Session.NotFoundError";
};

/** Interrupt the session, then (unless retained) remove it and check it is gone. */
async function cleanupPass(
  client: V2HostApi,
  sessionID: string,
  config: ReviewerConfig,
): Promise<boolean> {
  try {
    await client.session.interrupt(
      { sessionID },
      { signal: AbortSignal.timeout(2000) },
    );
    if (config.retainReviewSessions) return true;
  } catch (error) {
    if (isSessionNotFound(error)) return true;
  }
  if (config.retainReviewSessions) return false;
  try {
    await client.session.remove(
      { sessionID },
      { signal: AbortSignal.timeout(2000) },
    );
  } catch {
    // A lost response is not proof that deletion failed or succeeded.
  }
  try {
    await client.session.get(
      { sessionID },
      { signal: AbortSignal.timeout(2000) },
    );
    return false;
  } catch (error) {
    return isSessionNotFound(error);
  }
}

/**
 * Close a review session and drop its guards once cleanup is confirmed. The
 * tool guard stays until interruption and deletion have settled; when cleanup
 * cannot be confirmed it stays for good and this throws, so a caller's
 * `finally` overrides the provisional decision and fails closed.
 */
export async function finishReviewSession(
  client: V2HostApi,
  sessions: Map<string, PendingGeneration>,
  sessionID: string,
  { createIssued, config }: { createIssued: boolean; config: ReviewerConfig },
): Promise<void> {
  const pending = sessions.get(sessionID);
  if (pending) pending.closing = true;
  let cleanupConfirmed = !createIssued;
  for (let retry = 0; retry < 2 && !cleanupConfirmed; retry++) {
    // biome-ignore lint/performance/noAwaitInLoops: cleanup retry; each pass interrupts, removes and re-checks the reviewer session and runs again only while the previous pass left cleanup unconfirmed
    cleanupConfirmed = await cleanupPass(client, sessionID, config);
  }
  if (!cleanupConfirmed)
    throw new Error(
      "Reviewer cleanup could not be confirmed; isolation guards remain active",
    );
  sessions.delete(sessionID);
}
