import type { OnHandoff } from "../../../kernel/review-handoff.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { isSystemOneReviewerModel } from "../../../modules/config/services/reviewer-model.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import { SystemOneReviewerBackend } from "../../../modules/reviewer/services/backend.ts";
import type { RuntimeContext } from "../types.ts";
import { V1ReviewerBackend } from "./reviewer-backend.ts";

export interface V1ReviewBackend {
  owns(sessionID: string): boolean;
  review(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    onHandoff?: OnHandoff,
  ): Promise<ReviewExecutionResult>;
  waitForIdle(): Promise<void>;
}

function escalationConfig(config: ReviewerConfig): ReviewerConfig | undefined {
  const escalation = config.escalationReviewer;
  if (!escalation) return;
  const base = { ...config };
  delete base.escalationReviewer;
  return {
    ...base,
    ...escalation,
  };
}

export function createV1ReviewerBackend(
  ctx: RuntimeContext,
  config: ReviewerConfig,
  log: (message: string, details?: unknown) => void,
  recordReviewerMs: (envelope: ReviewEnvelope, ms: number) => void,
): V1ReviewBackend {
  if (!isSystemOneReviewerModel(config.model)) {
    return new V1ReviewerBackend(ctx, config, log, recordReviewerMs);
  }
  const secondaryConfig = escalationConfig(config);
  const secondary = secondaryConfig
    ? new V1ReviewerBackend(ctx, secondaryConfig, log, recordReviewerMs)
    : undefined;
  const primary = new SystemOneReviewerBackend(
    config,
    secondary
      ? (
          envelope: ReviewEnvelope,
          attempt: ReviewAttempt,
        ): Promise<ReviewExecutionResult> => secondary.review(envelope, attempt)
      : undefined,
    secondaryConfig?.model,
    undefined,
    recordReviewerMs,
  );
  return {
    owns: (sessionID: string) => secondary?.owns(sessionID) ?? false,
    review: (
      envelope: ReviewEnvelope,
      attempt: ReviewAttempt,
      onHandoff?: OnHandoff,
    ) => primary.review(envelope, attempt, undefined, onHandoff),
    waitForIdle: async () => {
      await Promise.all([primary.waitForIdle(), secondary?.waitForIdle()]);
    },
  };
}
