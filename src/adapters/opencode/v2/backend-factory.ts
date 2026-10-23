import type { Plugin } from "@opencode/plugin";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import {
  type OnHandoff,
  SystemOneReviewerBackend,
} from "../../../modules/reviewer/services/backend.ts";
import { isSystemOneReviewerModel } from "../../../modules/reviewer/services/reviewer-model.ts";
import type { V2HostApi } from "./host-api.ts";
import { V2ReviewerBackend } from "./reviewer-backend.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

export interface V2ReviewBackend {
  owns(sessionID: string): boolean;
  review(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    client: V2HostApi,
    onHandoff?: OnHandoff,
  ): Promise<ReviewExecutionResult>;
  waitForIdle(): Promise<void>;
  dispose(): Promise<void>;
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

export function createV2ReviewerBackend(
  context: Context,
  config: ReviewerConfig,
): V2ReviewBackend {
  if (!isSystemOneReviewerModel(config.model))
    return new V2ReviewerBackend(context, config);
  const secondaryConfig = escalationConfig(config);
  const secondary = secondaryConfig
    ? new V2ReviewerBackend(context, secondaryConfig)
    : undefined;
  const primary = new SystemOneReviewerBackend(
    config,
    undefined,
    secondaryConfig?.model,
  );
  return {
    owns: (sessionID: string) => secondary?.owns(sessionID) ?? false,
    review: (
      envelope: ReviewEnvelope,
      attempt: ReviewAttempt,
      client: V2HostApi,
      onHandoff?: OnHandoff,
    ) =>
      primary.review(
        envelope,
        attempt,
        secondary
          ? (value: ReviewEnvelope, current: ReviewAttempt) =>
              secondary.review(value, current, client)
          : undefined,
        onHandoff,
      ),
    waitForIdle: async () => {
      await Promise.all([primary.waitForIdle(), secondary?.waitForIdle()]);
    },
    dispose: async () => {
      await Promise.all([primary.waitForIdle(), secondary?.dispose()]);
    },
  };
}
