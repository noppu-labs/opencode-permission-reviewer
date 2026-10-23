// The results the System One backend builds around Jev's answer: Jev's own,
// undisposed until it is known to be final, and the reasoning reviewer's once
// handed off, each with the resolution of an escalation.

import type {
  ManualResolution,
  ReviewExecutionResult,
  SystemOneScores,
} from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import {
  applyEscalationDisposition,
  type EscalationCategory,
} from "../../decision/escalation.ts";
import { formatFailureReason } from "../../decision/failure-reason.ts";
import type { JevOutcome } from "./system-one-handoff.ts";

/** The reasoning reviewer a Jev result was handed to. */
export interface ReasoningHandoff {
  model: string;
  /** Jev rated the request critical, and its rating holds. */
  jevCritical: boolean;
  escalatedFrom: Required<
    NonNullable<ReviewExecutionResult["reviewerEscalatedFrom"]>
  >;
}

/** Jev's own result before any disposition, and the category that disposes
 *  it if it turns out to be final. */
export interface JevResult {
  result: ReviewExecutionResult;
  category: EscalationCategory;
}

/** Jev's own enforced result, credited to Jev with its scores. */
function systemOneResult(
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

/** Jev's own result for what it returned, not yet disposed. */
export function jevResult(jev: JevOutcome, config: ReviewerConfig): JevResult {
  if (jev.kind === "valid")
    return {
      result: systemOneResult(jev.enforced, config, jev.parsed.scores),
      category: "general",
    };
  if (jev.kind === "invalid")
    return {
      result: {
        kind: "escalate",
        reason:
          "System One reviewer returned a missing, invalid, or ambiguous decision.",
        decisionSource: "failure-safe",
        reviewerModel: config.model,
      },
      category: "invalid-decision",
    };
  return {
    result: {
      kind: "escalate",
      reason: formatFailureReason("System One reviewer", jev.error),
      decisionSource: "failure-safe",
      reviewerModel: config.model,
    },
    category: "reviewer-failure",
  };
}

export function jevScores(jev: JevOutcome): SystemOneScores | undefined {
  return jev.kind === "valid" ? jev.parsed.scores : undefined;
}

/** The reason handed to the reasoning reviewer: Jev's difficult reason (its
 *  escalation request or its contradictions) when it has one, else its own
 *  result's reason. */
export function handoffReason(jev: JevOutcome, own: JevResult): string {
  return (
    (jev.kind === "valid" ? jev.parsed.difficultReason : undefined) ??
    own.result.reason
  );
}

/** An escalation that a disposition already turned into a deny still counts
 *  as one. */
function withResolution(
  result: ReviewExecutionResult,
  resolution: ManualResolution,
): ReviewExecutionResult {
  return result.kind === "escalate" || result.escalationDisposition === "deny"
    ? { ...result, resolution }
    : result;
}

/** Jev's own result as final: an escalation is the reviewer's and takes
 *  Jev's own disposition. */
export function finalJevResult(
  own: JevResult,
  config: ReviewerConfig,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    withResolution(own.result, "reviewer"),
    config,
    own.category,
  );
}

/** The reason a reasoning approval stays an escalation when Jev rated the
 *  request critical risk. */
const JEV_CRITICAL_REASON =
  "Jev rated this request critical risk; a reasoning approval needs manual review.";

const INSUFFICIENT_EVIDENCE_REASON =
  "The reasoning reviewer did not find sufficient evidence to override the System One escalation.";

/** A reasoning allow stands only on sufficient evidence, and not when Jev's
 *  critical rating holds; otherwise it stays an escalation. */
function reconcileReasoningEscalation(
  result: ReviewExecutionResult,
  jevCritical: boolean,
): ReviewExecutionResult {
  if (result.kind !== "allow") return result;
  const sufficient = result.decision?.evidence_completeness === "sufficient";
  if (sufficient && !jevCritical) return result;
  const reviewerOutcome = result.decision?.outcome ?? result.reviewerOutcome;
  return {
    ...result,
    kind: "escalate",
    reason: jevCritical ? JEV_CRITICAL_REASON : INSUFFICIENT_EVIDENCE_REASON,
    ...(reviewerOutcome === undefined ? {} : { reviewerOutcome }),
  };
}

/** The reasoning reviewer's final result, credited to it unless it names its
 *  own model, with Jev's scores when Jev answered. Its own disposition, if
 *  any, stands; Jev's is never applied. */
export function reasoningResult(
  result: ReviewExecutionResult,
  handoff: ReasoningHandoff,
  systemOne: SystemOneScores | undefined,
): ReviewExecutionResult {
  const secondary = reconcileReasoningEscalation(result, handoff.jevCritical);
  return withResolution(
    {
      ...secondary,
      reviewerModel: secondary.reviewerModel ?? handoff.model,
      reviewerEscalatedFrom: handoff.escalatedFrom,
      ...(systemOne === undefined ? {} : { systemOne }),
    },
    secondary.decisionSource === "failure-safe"
      ? "reasoning-unavailable"
      : "reasoning-escalated",
  );
}

/** The reasoning reviewer threw instead of returning a result. */
export function reasoningFailureResult(
  config: ReviewerConfig,
  error: unknown,
  handoff: ReasoningHandoff,
  systemOne: SystemOneScores | undefined,
): ReviewExecutionResult {
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason: formatFailureReason("reasoning reviewer", error),
      decisionSource: "failure-safe",
      reviewerModel: handoff.model,
      reviewerEscalatedFrom: handoff.escalatedFrom,
      ...(systemOne === undefined ? {} : { systemOne }),
      resolution: "reasoning-unavailable",
    },
    config,
    "reviewer-failure",
  );
}
