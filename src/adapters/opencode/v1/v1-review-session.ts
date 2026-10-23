import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import { redactSecrets } from "../../../utils/redact.ts";
import { withTimeout } from "../../../utils/with-timeout.ts";
import { responseData } from "../transport.ts";
import type { OpenCodeClientLike } from "../types.ts";

/** Create an instruction-isolated session or fail into the configured error route. */
export async function createReviewerSession(
  client: OpenCodeClientLike,
  envelope: ReviewEnvelope,
  isolated: string | undefined,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ id: string; directory: string }> {
  if (isolated === undefined) throw new Error("reviewer isolation unavailable");
  const title = `[permission-review] ${envelope.request.permission}: ${redactSecrets(
    envelope.request.patterns.join(", "),
  ).slice(0, 120)}`;
  signal.throwIfAborted();
  const created = responseData(
    await withTimeout(
      client.session.create({
        signal,
        body: {
          title,
        },
        query: { directory: isolated },
      }),
      timeoutMs,
    ),
    "session.create",
  );
  if (typeof created.id !== "string")
    throw new Error("session.create returned an invalid session ID");
  return { id: created.id, directory: isolated };
}

/** The host's registered tool IDs as seen from the review session's location. */
export async function reviewerToolIDs(
  client: OpenCodeClientLike,
  directory: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string[]> {
  return responseData(
    await withTimeout(
      client.tool.ids({
        query: { directory },
        signal,
      }),
      timeoutMs,
    ),
    "tool.ids",
  );
}

/** Abort a review session; a failed or slow abort is ignored. */
export async function abortReviewerSession(
  client: OpenCodeClientLike,
  reviewSessionID: string,
  directory: string | undefined,
): Promise<void> {
  if (!client.session.abort) return;
  await withTimeout(
    client.session.abort({
      path: { id: reviewSessionID },
      query: { directory },
    }),
    5000,
  ).catch(() => {});
}

/** Delete a review session unless retained; a failed or slow delete is ignored. */
export async function deleteReviewerSession(
  client: OpenCodeClientLike,
  config: ReviewerConfig,
  reviewSessionID: string,
  directory: string,
): Promise<void> {
  if (config.retainReviewSessions || !client.session.delete) return;
  await withTimeout(
    client.session.delete({
      path: { id: reviewSessionID },
      query: { directory },
    }),
    Math.min(config.timeoutMs, 5_000),
  ).catch(() => {});
}
