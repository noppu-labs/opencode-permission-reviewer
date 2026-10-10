// The results the System One backend builds around Jev's answer: Jev's own,
// the fail-safe escalations, and the reasoning reviewer's once handed off.
import { applyEscalationDisposition } from "../escalation.ts";
import { formatFailureReason } from "../failure-reason.ts";
import type { ReviewExecutionResult, ReviewerConfig } from "../types.ts";
import type { SystemOneScores } from "./system-one-types.ts";

/** The reasoning reviewer a difficult Jev decision was handed to. */
export interface ReasoningHandoff {
  model: string;
  escalatedFrom: { model: string; reason: string };
}

/** Jev's own enforced result, credited to Jev with its scores. */
export function systemOneResult(
  enforced: ReviewExecutionResult,
  config: ReviewerConfig,
  systemOne: SystemOneScores,
): ReviewExecutionResult {
  return {
    ...enforced,
    decisionSource: "system-one-reviewer",
    reviewerModel: config.model,
    systemOne,
  };
}

export function invalidDecisionResult(
  config: ReviewerConfig,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason:
        "System One reviewer returned a missing, invalid, or ambiguous decision.",
      decisionSource: "failure-safe",
      reviewerModel: config.model,
    },
    config,
    "invalid-decision",
  );
}

/** A failure of Jev, or of the reasoning reviewer once handed off, keeping
 *  Jev's scores when it answered. */
export function reviewerFailureResult(
  config: ReviewerConfig,
  error: unknown,
  systemOne: SystemOneScores | undefined,
  reasoning: ReasoningHandoff | undefined,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason: formatFailureReason(
        reasoning === undefined ? "System One reviewer" : "reasoning reviewer",
        error,
      ),
      decisionSource: "failure-safe",
      reviewerModel: reasoning?.model ?? config.model,
      ...(reasoning === undefined
        ? {}
        : { reviewerEscalatedFrom: reasoning.escalatedFrom }),
      ...(systemOne === undefined ? {} : { systemOne }),
    },
    config,
    "reviewer-failure",
  );
}

/** A reasoning allow stands only on sufficient evidence; otherwise it stays an
 *  escalation. */
function reconcileReasoningEscalation(
  result: ReviewExecutionResult,
): ReviewExecutionResult {
  if (
    result.kind !== "allow" ||
    result.decision?.evidence_completeness === "sufficient"
  ) {
    return result;
  }
  const reviewerOutcome = result.decision?.outcome ?? result.reviewerOutcome;
  return {
    ...result,
    kind: "escalate",
    reason:
      "The reasoning reviewer did not find sufficient evidence to override the System One escalation.",
    ...(reviewerOutcome === undefined ? {} : { reviewerOutcome }),
  };
}

/** The reasoning reviewer's reconciled result, credited to it unless it names
 *  its own model, with Jev's scores. */
export function reasoningResult(
  result: ReviewExecutionResult,
  reasoning: ReasoningHandoff,
  systemOne: SystemOneScores,
): ReviewExecutionResult {
  const secondary = reconcileReasoningEscalation(result);
  return {
    ...secondary,
    reviewerModel: secondary.reviewerModel ?? reasoning.model,
    reviewerEscalatedFrom: reasoning.escalatedFrom,
    systemOne,
  };
}
