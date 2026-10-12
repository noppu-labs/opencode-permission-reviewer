// System One primary bases, choice scores, safety signals and the score record.

import type {
  EvidenceSufficiency,
  ReviewOutcome,
  RiskLevel,
  ScopeAlignment,
  UserAuthorization,
} from "../types.ts";

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
