import type { ReviewAttempt } from "../../core/review-attempt.ts";
import { enforceDecision } from "../../decision-gates.ts";
import { applyEscalationDisposition } from "../../escalation.ts";
import type { ReviewExecutionResult, ReviewerConfig } from "../../types.ts";
import type { V2HostApi } from "./host-api.ts";
import { type PendingGeneration, TOOL } from "./v2-review-pending.ts";
import { readReviewerResponse } from "./v2-review-response.ts";

/** The review session to create: its ID, isolated location and model. */
interface ReviewSessionRequest {
  id: string;
  directory: string;
  providerID: string;
  modelID: string;
  structured: boolean;
}

/** Create the review session denying every tool but the decision tool. */
export async function createReviewSession(
  client: V2HostApi,
  { id, directory, providerID, modelID, structured }: ReviewSessionRequest,
  config: ReviewerConfig,
  attempt: ReviewAttempt,
): Promise<void> {
  const created = await attempt.wait(
    client.session.create(
      {
        id,
        title: "Permission review",
        location: { directory },
        model: {
          id: modelID,
          providerID,
          ...(config.variant ? { variant: config.variant } : {}),
        },
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          ...(structured
            ? [{ action: TOOL, resource: "*", effect: "allow" as const }]
            : []),
        ],
      },
      { signal: attempt.signal },
    ),
  );
  if (created.id !== id || created.location.directory !== directory)
    throw new Error(
      "Reviewer session identity or isolation location does not match",
    );
}

/**
 * Prompt the review session until it returns one valid decision: three tries
 * for structured output, two for text, each after the previous answer was
 * invalid and with a correction appended. An ambiguous answer is never retried.
 */
export async function promptUntilDecided(
  client: V2HostApi,
  sessionID: string,
  pending: PendingGeneration,
  config: ReviewerConfig,
): Promise<ReviewExecutionResult> {
  const { attempt } = pending;
  const tries = pending.structured ? 3 : 2;
  for (let index = 0; index < tries; index++) {
    pending.results = [];
    const signal = AbortSignal.any([
      attempt.signal,
      AbortSignal.timeout(config.timeoutMs),
    ]);
    // biome-ignore lint/performance/noAwaitInLoops: re-prompts the same exclusively owned reviewer session only after the previous answer was invalid, appending a correction to the prompt; prompts on one session must not overlap
    const admitted = await attempt.wait(
      client.session.prompt({ sessionID, text: pending.prompt }, { signal }),
    );
    await attempt.wait(client.session.wait({ sessionID }, { signal }));
    if (!attempt.active()) throw new Error("Review no longer active");
    const messages = await attempt.wait(
      client.session.context({ sessionID }, { signal }),
    );
    const { ambiguous, parsed } = readReviewerResponse(
      messages,
      admitted.id,
      pending,
    );
    if (ambiguous) break;
    if (parsed)
      return {
        ...enforceDecision(parsed, config),
        reviewSessionID: sessionID,
        decisionSource: "llm-reviewer",
      };
    pending.prompt +=
      "\nThe prior response was invalid. Return exactly one valid decision using the requested format.";
  }
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason: "Reviewer returned missing, invalid, or ambiguous output.",
      reviewSessionID: sessionID,
      decisionSource: "failure-safe",
    },
    config,
    "invalid-decision",
  );
}
