import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import { splitModel } from "../../../modules/config/services/reviewer-model.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import {
  reviewerEvidencePrompt,
  reviewerFailure,
} from "./v1-review-decision.ts";
import {
  openReviewSession,
  releaseReviewSession,
  type V1ReviewRun,
} from "./v1-review-lifecycle.ts";
import { type ReviewerPrompt, reviewerTools } from "./v1-review-prompt.ts";
import { reviewerToolIDs } from "./v1-review-session.ts";
import { promptForDecision } from "./v1-review-turn.ts";

export async function runV1Review(
  run: V1ReviewRun,
  envelope: ReviewEnvelope,
  attempt: ReviewAttempt,
): Promise<ReviewExecutionResult> {
  const { providerID, modelID } = splitModel(run.config.model);
  const model = { providerID, modelID };
  let reviewSessionID: string | undefined;
  let sessionDirectory: string | undefined;

  try {
    const created = await openReviewSession(run, envelope, attempt);
    sessionDirectory = created.directory;
    reviewSessionID = created.id;
    run.sessions.add(reviewSessionID);
    const toolIDs = await reviewerToolIDs(
      run.ctx.client,
      sessionDirectory,
      attempt.signal,
      run.metadataCallTimeoutMs,
    );
    const request: ReviewerPrompt = {
      sessionID: reviewSessionID,
      directory: sessionDirectory,
      model,
      tools: reviewerTools(toolIDs, run.config.outputFormat),
      prompt: reviewerEvidencePrompt(envelope, run.config),
    };
    return await promptForDecision(
      run.ctx.client,
      run.config,
      { envelope, request, attempt },
      run.recordReviewerMs,
    );
  } catch (error) {
    return reviewerFailure(error, reviewSessionID, run.config);
  } finally {
    if (reviewSessionID !== undefined)
      await releaseReviewSession(run, reviewSessionID, sessionDirectory);
  }
}
