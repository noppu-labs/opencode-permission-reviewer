// The consistency checks between Jev's disposition, its supporting choices and
// its safety signals. Any failed check marks an allow or deny difficult.
import type { ReviewDecision, ReviewerConfig } from "../types.ts";
import type {
  SystemOnePrimaryBasis,
  SystemOneSignals,
} from "./system-one-types.ts";

const SAFE_BASES = new Set<SystemOnePrimaryBasis>([
  "authorized_routine",
  "authorized_reversible_change",
]);

export interface ConsistencyFacts {
  decision: ReviewDecision;
  basis: SystemOnePrimaryBasis;
  /** The weakest confidence among the five supporting choices. */
  supportingConfidence: number;
  signals: SystemOneSignals;
}

const lowRiskSafetySignal = (s: SystemOneSignals): number =>
  Math.max(
    s.unauthorizedDataLoss,
    s.untrustedSensitiveDisclosure,
    s.excessiveCredentialAccess,
    s.unauthorizedSecurityChange,
  );

function dispositionChecks(
  { decision, basis, supportingConfidence }: ConsistencyFacts,
  config: ReviewerConfig,
  contradictions: string[],
): void {
  if (decision.confidence < config.systemOneConfidenceThreshold) {
    contradictions.push(
      `System One outcome confidence ${decision.confidence.toFixed(2)} is below ${config.systemOneConfidenceThreshold.toFixed(2)}`,
    );
  }
  if (decision.outcome === "allow" && supportingConfidence < 0.3)
    contradictions.push("a supporting classification has very low confidence");
  if (decision.outcome === "allow" && !SAFE_BASES.has(basis))
    contradictions.push("an allow used a restrictive primary basis");
  if (decision.outcome === "deny" && SAFE_BASES.has(basis))
    contradictions.push("a deny used an approving primary basis");
}

function scopeAndEvidenceChecks(
  { decision, signals: s }: ConsistencyFacts,
  contradictions: string[],
): void {
  if (decision.scope_alignment === "aligned" && s.withinIntentScope < 0.3)
    contradictions.push(
      "scope alignment conflicts with the intent-scope signal",
    );
  if (decision.scope_alignment === "misaligned" && s.withinIntentScope > 0.7)
    contradictions.push(
      "scope misalignment conflicts with the intent-scope signal",
    );
  if (
    decision.evidence_completeness === "sufficient" &&
    s.essentialEvidenceMissing > 0.7
  )
    contradictions.push(
      "evidence completeness conflicts with the missing-evidence signal",
    );
  if (
    decision.evidence_completeness === "insufficient" &&
    s.essentialEvidenceMissing < 0.3
  )
    contradictions.push(
      "evidence insufficiency conflicts with the missing-evidence signal",
    );
}

function authorizationAndRiskChecks(
  { decision, signals: s }: ConsistencyFacts,
  contradictions: string[],
): void {
  if (
    (decision.user_authorization === "high" ||
      decision.user_authorization === "medium") &&
    s.materialAuthorization < 0.3
  )
    contradictions.push(
      "authorization level conflicts with the material-authorization signal",
    );
  if (decision.risk_level === "low" && lowRiskSafetySignal(s) > 0.7)
    contradictions.push("low risk conflicts with a material safety signal");
  if (s.absolutePolicyDeny >= 0.7 && decision.outcome !== "deny")
    contradictions.push(
      "the disposition conflicts with an absolute policy-deny signal",
    );
}

/** The stricter checks an allow alone must pass. */
function allowChecks(
  { decision, signals: s }: ConsistencyFacts,
  contradictions: string[],
): void {
  const unsafe = Math.max(
    s.unauthorizedDataLoss,
    s.untrustedSensitiveDisclosure,
    s.excessiveCredentialAccess,
    s.unauthorizedSecurityChange,
    s.unauthorizedExternalMutation,
    s.essentialEvidenceMissing,
    s.absolutePolicyDeny,
  );
  if (unsafe >= 0.5)
    contradictions.push("an allow has a material safety signal");
  if (s.withinIntentScope < 0.5)
    contradictions.push("an allow lacks probable scope alignment");
  if (decision.risk_level !== "low" && s.materialAuthorization < 0.5)
    contradictions.push(
      "a non-low-risk allow lacks confident material authorization",
    );
  if (
    decision.evidence_completeness !== "sufficient" &&
    decision.confidence < 0.7
  )
    contradictions.push(
      "an allow with incomplete evidence lacks strong outcome confidence",
    );
}

/** The failed checks, in check order, without repeats. */
export function systemOneContradictions(
  facts: ConsistencyFacts,
  config: ReviewerConfig,
): string[] {
  const contradictions: string[] = [];
  dispositionChecks(facts, config, contradictions);
  scopeAndEvidenceChecks(facts, contradictions);
  authorizationAndRiskChecks(facts, contradictions);
  if (facts.decision.outcome === "allow") allowChecks(facts, contradictions);
  return [...new Set(contradictions)];
}
