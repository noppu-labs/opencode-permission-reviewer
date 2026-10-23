import type {
  EvidenceSufficiency,
  ReviewDecision,
  ReviewOutcome,
  RiskLevel,
  ScopeAlignment,
  UserAuthorization,
} from "./review-decision.ts";

/** Effective disposition applied to an internal escalate result. */
export type EscalationDisposition = "manual" | "deny";

/** Why a System One (Jev) result was handed to the reasoning reviewer. */
export type HandoffTrigger =
  | "jev-escalate"
  | "jev-uncertain-allow"
  | "jev-gate"
  | "jev-invalid"
  | "jev-failure"
  | "jev-uncertain-deny";

/** The primary model, routing reason and hand-off trigger of a review a
 *  second reviewer decided. */
export interface EscalatedFrom {
  model: string;
  reason: string;
  trigger?: HandoffTrigger;
}

/** How an escalation that left the System One backend was reached. */
export type ManualResolution =
  | "reviewer"
  | "reasoning-escalated"
  | "reasoning-unavailable"
  | "budget-exhausted";

export interface ReviewExecutionResult {
  kind: "allow" | "deny" | "escalate";
  decision?: ReviewDecision;
  reason: string;
  reviewSessionID?: string;
  /** Which layer produced this result; threaded into the audit record. */
  decisionSource?: DecisionSource;
  /** Actual model that produced the final reviewer decision. */
  reviewerModel?: string;
  /** Primary model, routing reason and hand-off trigger when a second
   *  reviewer was used. */
  reviewerEscalatedFrom?: EscalatedFrom;
  /** Jev's scores whenever it returned a parsed decision. */
  systemOne?: SystemOneScores;
  /**
   * Structured outcome from the reviewer LLM before gates/disposition.
   * Absent when no valid structured decision was produced.
   */
  reviewerOutcome?: ReviewOutcome;
  /**
   * How an internal escalate was disposed at the enforcement boundary.
   * Absent when the result was never an escalate (explicit allow/deny) or when
   * the request was already answered manually (`manual-superseded`).
   */
  escalationDisposition?: EscalationDisposition;
  /** Set only by the System One backend, on escalations; kept when a
   *  disposition turns one into a deny. */
  resolution?: ManualResolution;
}

/** Which layer produced the final decision for a request. Threaded into the
 *  audit record so reports can split outcomes by source. */
export type DecisionSource =
  | "emergency-brake"
  | "deterministic-policy"
  | "llm-reviewer"
  | "system-one-reviewer"
  | "manual-superseded"
  | "failure-safe";

export const SYSTEM_ONE_BASES = [
  "authorized_routine",
  "authorized_reversible_change",
  "insufficient_authorization",
  "scope_mismatch",
  "insufficient_evidence",
  "destructive_effect",
  "credential_or_private_data",
  "security_or_privilege_change",
  "external_or_remote_effect",
  "trusted_policy_restriction",
  "conflicting_evidence",
] as const;
export type SystemOnePrimaryBasis = (typeof SYSTEM_ONE_BASES)[number];

export interface SystemOneChoiceScore<T extends string> {
  choice: T;
  confidence: number;
}

/** Probability (0-1) that each safety question is true. */
export interface SystemOneSignals {
  materialAuthorization: number;
  withinIntentScope: number;
  unauthorizedDataLoss: number;
  untrustedSensitiveDisclosure: number;
  excessiveCredentialAccess: number;
  unauthorizedSecurityChange: number;
  unauthorizedExternalMutation: number;
  essentialEvidenceMissing: number;
  absolutePolicyDeny: number;
}

/**
 * Jev's own answer, kept apart from the final decision because a reasoning
 * reviewer may replace it. Numbers, enum choices, fixed contradiction strings,
 * and the provider-reported model ID only; never evidence text.
 */
export interface SystemOneScores {
  /** Versioned model ID the provider reported as having answered. */
  returnedModel: string;
  outcome: SystemOneChoiceScore<ReviewOutcome> & {
    probabilities: Record<ReviewOutcome, number>;
  };
  supporting: {
    riskLevel: SystemOneChoiceScore<RiskLevel>;
    userAuthorization: SystemOneChoiceScore<UserAuthorization>;
    scopeAlignment: SystemOneChoiceScore<ScopeAlignment>;
    evidenceCompleteness: SystemOneChoiceScore<EvidenceSufficiency>;
    primaryBasis: SystemOneChoiceScore<SystemOnePrimaryBasis>;
  };
  signals: SystemOneSignals;
  /** Consistency checks that failed; any one marks an allow or deny difficult. */
  contradictions: string[];
  reasoningRecommended: boolean;
}
