export type RiskLevel = "low" | "medium" | "high" | "critical";

export type UserAuthorization = "high" | "medium" | "low" | "unknown";

export type ReviewOutcome = "allow" | "deny" | "escalate";

export type ScopeAlignment = "aligned" | "partial" | "misaligned" | "unknown";

export type EvidenceSufficiency =
  | "sufficient"
  | "partial"
  | "insufficient"
  | "unknown";

export interface ReviewDecision {
  /** Structured-decision schema version. Always 2 for the current schema. */
  version: 2;
  outcome: ReviewOutcome;
  risk_level: RiskLevel;
  user_authorization: UserAuthorization;
  /** How well the request aligns with the recovered user/delegated intent. */
  scope_alignment: ScopeAlignment;
  /** Whether the evidence was sufficient to decide confidently. */
  evidence_completeness: EvidenceSufficiency;
  rationale: string;
  confidence: number;
  /** Optional script-only semantic analysis. Never conveys authorization. */
  script_analysis?: string;
}

export interface ApprovedAnnotation {
  requestID: string;
  sessionID: string;
  decision: ReviewDecision;
}
