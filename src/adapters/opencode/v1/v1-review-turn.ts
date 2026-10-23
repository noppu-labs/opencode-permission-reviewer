import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../../types.ts";
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
 * Text mode has no host-side schema retry (json_schema sets `retryCount: 2`),
 * so re-prompt once with `TEXT_MODE_RETRY_NOTE`. The retry goes through the
 * same strict extractor and `enforceDecision`, so it cannot approve anything
 * the first parse would not; an unparsed retry takes the `invalid-decision`
 * escalation.
 */
export async function promptForDecision(
  client: OpenCodeClientLike,
  config: ReviewerConfig,
  { envelope, request, attempt }: ReviewTurn,
  recordReviewerMs: (envelope: ReviewEnvelope, ms: number) => void,
): Promise<ReviewExecutionResult> {
  const { outputFormat } = config;
  const first = await promptReviewer(client, config, request, attempt);
  // Record the elapsed time before `parseReviewerResponse` can throw, so an
  // invalid response still carries `reviewerMs` in the audit.
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
