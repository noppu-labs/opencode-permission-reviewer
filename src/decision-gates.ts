import type {
  ReviewDecision,
  ReviewExecutionResult,
  ReviewerConfig,
} from "./types.ts";

/**
 * The escalation reason for an `allow` that the risk matrix or a schema v2
 * gate blocks, or `undefined` when the allow stands.
 */
function allowGateReason(
  decision: ReviewDecision,
  config: ReviewerConfig,
): string | undefined {
  // Deterministic risk×authorization gate, driven by the configurable
  // riskPolicy matrix.
  const { risk_level: risk, user_authorization: auth } = decision;
  const permitted = config.riskPolicy.allow[risk];
  if (permitted === undefined || !permitted.includes(auth)) {
    return `Reviewer allow for ${risk} risk with ${auth} user authorization; manual review required.`;
  }

  // Schema v2 gate: a request the reviewer judged misaligned with the
  // recovered user/delegated intent is never auto-allowed.
  if (decision.scope_alignment === "misaligned") {
    return "Reviewer judged the request misaligned with the stated intent; manual review required.";
  }

  // Schema v2 gate: for medium-or-higher risk, insufficient evidence
  // prevents auto-allow (the reviewer cannot confidently judge).
  if (
    (risk === "medium" || risk === "high") &&
    decision.evidence_completeness === "insufficient"
  ) {
    return `Reviewer judged evidence insufficient for ${risk} risk; manual review required.`;
  }
  return undefined;
}

/**
 * The escalation reason a gate imposes on a non-denial, or `undefined` when
 * the reviewer's own outcome and rationale stand.
 */
function gateReason(
  decision: ReviewDecision,
  config: ReviewerConfig,
): string | undefined {
  if (decision.risk_level === "critical") {
    return "Reviewer returned a non-denial for critical risk; manual review required.";
  }

  // The auto-allow confidence floor is the stricter of the two configured
  // thresholds; riskPolicy.minimumConfidence must not be silently ignorable.
  const effectiveThreshold = Math.max(
    config.confidenceThreshold,
    config.riskPolicy.minimumConfidence,
  );
  if (decision.confidence < effectiveThreshold) {
    return `Reviewer confidence ${decision.confidence.toFixed(2)} is below ${effectiveThreshold.toFixed(2)}.`;
  }

  // The risk-matrix and schema v2 gates apply to an `allow` only; an
  // `escalate` keeps the model's outcome.
  if (decision.outcome !== "allow") return undefined;
  return allowGateReason(decision, config);
}

export function enforceDecision(
  decision: ReviewDecision,
  config: ReviewerConfig,
): ReviewExecutionResult {
  const reviewerOutcome = decision.outcome;

  // Confidence limits automatic approval; a validated denial stays a denial.
  if (decision.outcome === "deny") {
    return {
      kind: "deny",
      decision,
      reason: decision.rationale,
      reviewerOutcome,
    };
  }

  const gated = gateReason(decision, config);
  if (gated !== undefined) {
    return { kind: "escalate", decision, reason: gated, reviewerOutcome };
  }
  return {
    kind: decision.outcome === "allow" ? "allow" : "escalate",
    decision,
    reason: decision.rationale,
    reviewerOutcome,
  };
}
