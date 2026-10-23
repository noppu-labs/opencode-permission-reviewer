// Evidence the coordinator bridges onto a request's attempt for its audit
// record: merged only while the attempt is still active.
import type { ReviewEnvelope } from "../../context/models/review-envelope.ts";
import type { ReviewAttempt } from "./review-attempt.ts";

export function rememberEvidence(
  attempts: Map<string, ReviewAttempt>,
  requestID: string,
  evidence: ReviewAttempt["evidence"],
): void {
  const attempt = attempts.get(requestID);
  if (attempt?.active()) Object.assign(attempt.evidence, evidence);
}

/** Fold the reviewer phase's elapsed time into the request's timing record. */
export function recordReviewerMs(
  attempts: Map<string, ReviewAttempt>,
  envelope: ReviewEnvelope,
  reviewerMs: number,
): void {
  if (!attempts.get(envelope.request.id)?.active()) return;
  const currentTimings =
    attempts.get(envelope.request.id)?.evidence.timings ?? {};
  rememberEvidence(attempts, envelope.request.id, {
    timings: { ...currentTimings, reviewerMs },
  });
}
