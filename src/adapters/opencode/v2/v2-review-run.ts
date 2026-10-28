import { randomBytes } from "node:crypto";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { splitModel } from "../../../modules/config/services/reviewer-model.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import { applyEscalationDisposition } from "../../../modules/decision/escalation.ts";
import { formatFailureReason } from "../../../modules/decision/failure-reason.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import type { V2HostApi } from "./host-api.ts";
import { finishReviewSession } from "./v2-review-cleanup.ts";
import type { ReviewerLocation } from "./v2-review-location.ts";
import {
  type PendingGeneration,
  pendingGeneration,
} from "./v2-review-pending.ts";
import { assertReviewerLocation } from "./v2-review-preflight.ts";
import {
  createReviewSession,
  promptUntilDecided,
} from "./v2-review-session.ts";

/** What one V2 review needs from the backend that owns it. */
export interface V2ReviewRun {
  config: ReviewerConfig;
  sessions: Map<string, PendingGeneration>;
  location(client: V2HostApi): Promise<ReviewerLocation>;
}

export async function runV2Review(
  run: V2ReviewRun,
  envelope: ReviewEnvelope,
  attempt: ReviewAttempt,
  client: V2HostApi,
): Promise<ReviewExecutionResult> {
  const { config, sessions } = run;
  const { providerID, modelID } = splitModel(config.model);
  const id = `ses_${randomBytes(16).toString("hex")}`;
  let createIssued = false;
  try {
    const { directory } = await attempt.wait(run.location(client));
    const { variant } = await assertReviewerLocation(
      client,
      directory,
      attempt,
      { providerID, modelID },
      config,
    );
    const pending = pendingGeneration(envelope, attempt, config);
    sessions.set(id, pending);
    createIssued = true;
    await createReviewSession(
      client,
      {
        id,
        directory,
        providerID,
        modelID,
        structured: pending.structured,
        variant,
      },
      attempt,
    );
    return await promptUntilDecided(client, id, pending, config);
  } catch (error) {
    return applyEscalationDisposition(
      {
        kind: "escalate",
        reason: formatFailureReason("reviewer session call", error),
        reviewSessionID: id,
        decisionSource: "failure-safe",
      },
      config,
      "reviewer-failure",
    );
  } finally {
    await finishReviewSession(client, sessions, id, { createIssued, config });
  }
}
