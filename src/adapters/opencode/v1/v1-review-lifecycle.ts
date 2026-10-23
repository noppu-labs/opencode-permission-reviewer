import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import type { RuntimeContext } from "../types.ts";
import type { IsolatedReviewerDirectory } from "./v1-isolated-directory.ts";
import { assertNoMcpServers } from "./v1-mcp-guard.ts";
import {
  abortReviewerSession,
  createReviewerSession,
  deleteReviewerSession,
} from "./v1-review-session.ts";

/** What one V1 review needs from the backend that owns it. */
export interface V1ReviewRun {
  ctx: RuntimeContext;
  config: ReviewerConfig;
  isolatedDirectory: IsolatedReviewerDirectory;
  /** Review sessions currently owned, so their events are not reviewed. */
  sessions: Set<string>;
  metadataCallTimeoutMs: number;
  recordReviewerMs: (envelope: ReviewEnvelope, ms: number) => void;
}

/** Open a review session in the isolated, MCP-free location. */
export async function openReviewSession(
  run: V1ReviewRun,
  envelope: ReviewEnvelope,
  attempt: ReviewAttempt,
): Promise<{ id: string; directory: string }> {
  // Never review inside the project if instruction isolation fails.
  const isolated = await attempt.wait(run.isolatedDirectory.resolve());
  // The host's report, not the local config, is the guarantee (`assertNoMcpServers`).
  await assertNoMcpServers(
    run.ctx.client,
    isolated,
    attempt,
    run.metadataCallTimeoutMs,
  );
  return createReviewerSession(
    run.ctx.client,
    envelope,
    isolated,
    attempt.signal,
    run.metadataCallTimeoutMs,
  );
}

/** Abort, then (unless retained) delete the review session; failures are ignored. */
export async function releaseReviewSession(
  run: V1ReviewRun,
  reviewSessionID: string,
  sessionDirectory: string | undefined,
): Promise<void> {
  await abortReviewerSession(run.ctx.client, reviewSessionID, sessionDirectory);
  run.sessions.delete(reviewSessionID);
  await deleteReviewerSession(
    run.ctx.client,
    run.config,
    reviewSessionID,
    sessionDirectory ?? run.ctx.directory,
  );
}
