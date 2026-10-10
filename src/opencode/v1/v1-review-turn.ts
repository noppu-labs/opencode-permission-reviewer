import type { ReviewAttempt } from "../../core/review-attempt.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../types.ts";
import type { OpenCodeClientLike } from "../types.ts";
import { reviewerDecision } from "./v1-review-decision.ts";
import {
  parseReviewerResponse,
  promptReviewer,
  type ReviewerPrompt,
  TEXT_MODE_RETRY_NOTE,
} from "./v1-review-prompt.ts";

/** One review's envelope, prompt request and attempt. */
interface ReviewTurn {
  envelope: ReviewEnvelope;
  request: ReviewerPrompt;
  attempt: ReviewAttempt;
}

/**
 * Prompt the reviewer and turn its answer into a result. Text mode has no
 * host-side schema enforcement or retry (unlike json_schema's
 * `retryCount: 2`), so a single flaky response would escalate: re-prompt
 * once with a corrective note. The retry still goes through the same strict
 * extractor and enforceDecision invariants, so it can never approve anything
 * the first parse would not; it only reduces spurious escalations from
 * weaker models. Structured mode is left alone because OpenCode already
 * retries it. The retry output is authoritative: if it does not parse, the
 * review falls through to the manual-review path.
 */
export async function promptForDecision(
  client: OpenCodeClientLike,
  config: ReviewerConfig,
  { envelope, request, attempt }: ReviewTurn,
  recordReviewerMs: (envelope: ReviewEnvelope, ms: number) => void,
): Promise<ReviewExecutionResult> {
  const { outputFormat } = config;
  const first = await promptReviewer(client, config, request, attempt);
  // Record the elapsed time as soon as the reviewer returns, so a response
  // that turns out to be invalid (no data / transport error) still carries
  // reviewerMs in the audit before responseData throws below.
  recordReviewerMs(envelope, first.ms);
  const parsed = parseReviewerResponse(first.response, outputFormat);
  if (parsed || outputFormat !== "text")
    return reviewerDecision(parsed, request.sessionID, config);
  const retry = await promptReviewer(
    client,
    config,
    request,
    attempt,
    TEXT_MODE_RETRY_NOTE,
  );
  recordReviewerMs(envelope, first.ms + retry.ms);
  return reviewerDecision(
    parseReviewerResponse(retry.response, outputFormat),
    request.sessionID,
    config,
  );
}
