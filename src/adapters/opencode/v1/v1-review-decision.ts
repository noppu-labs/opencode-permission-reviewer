import { buildEvidenceResult } from "../../../modules/context/services/prompt/context.ts";
import {
  buildReviewerPrompt,
  DEFAULT_TENANT_POLICY,
} from "../../../modules/context/services/prompt/policy.ts";
import { enforceDecision } from "../../../modules/review/services/decision/decision-gates.ts";
import { applyEscalationDisposition } from "../../../modules/review/services/decision/escalation.ts";
import { formatFailureReason } from "../../../modules/review/services/decision/failure-reason.ts";
import type {
  ReviewDecision,
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../../types.ts";

/** Build the evidence prompt, folding its completeness into the envelope. */
export function reviewerEvidencePrompt(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
): string {
  const policy = config.policy ?? DEFAULT_TENANT_POLICY;
  const evidence = buildEvidenceResult(envelope, config);
  envelope.actionEvidenceComplete =
    envelope.actionEvidenceComplete !== false &&
    evidence.actionEvidenceComplete;
  return buildReviewerPrompt(policy, evidence.text, config.outputFormat);
}

/** The gated reviewer decision, or the invalid-decision escalation without one. */
export function reviewerDecision(
  parsed: ReviewDecision | undefined,
  reviewSessionID: string,
  config: ReviewerConfig,
): ReviewExecutionResult {
  if (!parsed) {
    return applyEscalationDisposition(
      {
        kind: "escalate",
        reason:
          config.outputFormat === "text"
            ? "Reviewer returned missing, invalid, or unparseable text output."
            : "Reviewer returned missing or invalid structured output.",
        reviewSessionID,
        decisionSource: "failure-safe",
      },
      config,
      "invalid-decision",
    );
  }
  return {
    ...enforceDecision(parsed, config),
    reviewSessionID,
    decisionSource: "llm-reviewer",
  };
}

/** The reviewer-failure escalation for an error thrown during the review. */
export function reviewerFailure(
  error: unknown,
  reviewSessionID: string | undefined,
  config: ReviewerConfig,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason: formatFailureReason("reviewer backend", error),
      ...(reviewSessionID === undefined ? {} : { reviewSessionID }),
      decisionSource: "failure-safe",
    },
    config,
    "reviewer-failure",
  );
}
