// Jev's verdict on its decision: the consistency contradictions that make it
// difficult, whether reasoning should resolve it, and the scores kept for the
// audit.
import type { ReviewDecision, ReviewerConfig } from "../types.ts";
import type { ParsedAnswers } from "./system-one-answers.ts";
import { systemOneContradictions } from "./system-one-consistency.ts";
import type {
  SystemOneChoiceScore,
  SystemOnePrimaryBasis,
  SystemOneScores,
} from "./system-one-types.ts";

export interface ParsedSystemOneReview {
  decision: ReviewDecision;
  primaryBasis: SystemOnePrimaryBasis;
  difficultReason?: string;
  reasoningRecommended: boolean;
  returnedModel: string;
  scores: SystemOneScores;
}

function difficultReasonFor(
  decision: ReviewDecision,
  contradictions: string[],
): string | undefined {
  if (decision.outcome === "escalate")
    return "System One explicitly requested a reasoning or human review.";
  return contradictions.length > 0
    ? `System One decision is uncertain or inconsistent: ${contradictions.join("; ")}.`
    : undefined;
}

/** A difficult allow always merits reasoning; a difficult escalation only when
 *  allow and deny together are probable enough for reasoning to resolve. */
function recommendsReasoning(
  decision: ReviewDecision,
  difficultReason: string | undefined,
  outcome: ParsedAnswers["outcome"],
  config: ReviewerConfig,
): boolean {
  return (
    difficultReason !== undefined &&
    (decision.outcome === "allow" ||
      (decision.outcome === "escalate" &&
        outcome.probabilities.allow + outcome.probabilities.deny >=
          config.systemOneReasoningThreshold))
  );
}

const score = <T extends string>(
  parsed: SystemOneChoiceScore<T>,
): SystemOneChoiceScore<T> => ({
  choice: parsed.choice,
  confidence: parsed.confidence,
});

function supportingScores(
  answers: ParsedAnswers,
): SystemOneScores["supporting"] {
  return {
    riskLevel: score(answers.risk),
    userAuthorization: score(answers.authorization),
    scopeAlignment: score(answers.alignment),
    evidenceCompleteness: score(answers.completeness),
    primaryBasis: score(answers.basis),
  };
}

/** Jev's decision, its consistency verdict and its scores, from a valid
 *  answer set. */
export function systemOneVerdict(
  answers: ParsedAnswers,
  decision: ReviewDecision,
  returnedModel: string,
  config: ReviewerConfig,
): ParsedSystemOneReview {
  const { outcome, risk, authorization, alignment, completeness, basis } =
    answers;

  const uniqueContradictions = systemOneContradictions(
    {
      decision,
      basis: basis.choice,
      supportingConfidence: Math.min(
        risk.confidence,
        authorization.confidence,
        alignment.confidence,
        completeness.confidence,
        basis.confidence,
      ),
      signals: answers.signals,
    },
    config,
  );
  const difficultReason = difficultReasonFor(decision, uniqueContradictions);
  const reasoningRecommended = recommendsReasoning(
    decision,
    difficultReason,
    outcome,
    config,
  );
  return {
    decision,
    primaryBasis: basis.choice,
    ...(difficultReason === undefined ? {} : { difficultReason }),
    reasoningRecommended,
    returnedModel,
    scores: {
      returnedModel,
      outcome: {
        ...score(outcome),
        probabilities: { ...outcome.probabilities },
      },
      supporting: supportingScores(answers),
      signals: answers.signals,
      contradictions: uniqueContradictions,
      reasoningRecommended,
    },
  };
}
