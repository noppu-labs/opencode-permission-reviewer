// The audit record schema and the decision-source label threaded into it.

import type { EvidenceConfidence } from "./actor-context-types.ts";
import type { SystemOneScores } from "./system-one/system-one-types.ts";
import type {
  ActorProfile,
  EscalationDisposition,
  ReviewExecutionResult,
  ReviewOutcome,
  RiskLevel,
  ScopeAlignment,
  UserAuthorization,
} from "./types.ts";

/** Which layer produced the final decision for a request. Threaded into the
 *  audit record so reports can split outcomes by source. */
export type DecisionSource =
  | "emergency-brake"
  | "deterministic-policy"
  | "llm-reviewer"
  | "system-one-reviewer"
  | "manual-superseded"
  | "failure-safe";

export interface ReviewAuditRecord {
  /**
   * Audit schema version. Present on every record; readers default a missing
   * field to `1` (additive — old records are still valid).
   * Bump only on a breaking change to the record shape.
   */
  schemaVersion?: number;
  reviewID?: string;
  hostRequestID?: string;
  hostGeneration?: "v1" | "v2";
  hostVersion?: string;
  generation?: string;
  nativeAction?: string;
  directory?: string;
  application?:
    | "evaluation-returned"
    | "reply-accepted"
    | "human-pending"
    | "superseded"
    | "cancelled"
    | "unknown";
  pluginVersion?: string;
  effectiveConfigHash?: string;
  actionFingerprint?: string;
  /** Version of the structured-decision schema the reviewer was asked to emit. */
  decisionSchemaVersion?: number;
  /** Version of the reviewer system prompt used for this decision. */
  promptVersion?: string;
  /** Which layer produced the outcome (brake, policy, reviewer, supersede,
   *  failure-safe). Absent on legacy v1 records. */
  decisionSource?: DecisionSource;
  timestamp: string;
  durationMs: number;
  requestID: string;
  sessionID: string;
  permission: string;
  /** Stable hash of the canonical request (permission, patterns, metadata,
   *  tool) for cross-record correlation. Absent on legacy v1 records. */
  actionHash?: string;
  outcome: ReviewExecutionResult["kind"];
  reason: string;
  riskLevel?: RiskLevel;
  userAuthorization?: UserAuthorization;
  /** How well the action aligned with the recovered intent (from the reviewer
   *  decision). Absent when no reviewer decision was reached. */
  scopeAlignment?: ScopeAlignment;
  confidence?: number;
  /**
   * Structured outcome emitted by the reviewer LLM before gates/disposition.
   * Absent when no valid structured decision was produced (brake, policy,
   * failure-safe, supersede).
   */
  reviewerOutcome?: ReviewOutcome;
  /**
   * How an internal escalate was disposed. Present only when the logical result
   * was escalate (or a gate converted allow→escalate) and enforcement chose
   * manual or deny. Absent for explicit deny, allow, and manual-superseded.
   */
  escalationDisposition?: EscalationDisposition;
  /** The model that produced the final reviewer decision. */
  reviewerModel?: string;
  /** Present when a System One result was handed to a reasoning reviewer. */
  reviewerEscalatedFrom?: { model: string; reason: string };
  /** Jev's scores whenever it returned a parsed decision, including when a
   *  reasoning reviewer made the final call. */
  systemOne?: SystemOneScores;
  /** Per-phase timings. Absent on legacy v1 records and on deterministic paths
   *  that never reach that phase. */
  timings?: {
    contextMs?: number;
    enrichmentMs?: number;
    reviewerMs?: number;
    replyMs?: number;
  };
  /** Non-fatal warnings accumulated during evidence collection/analysis. */
  warnings?: string[];
  reviewerSessionID?: string;
  /** Content identity and inspection mode only; never script text or local path. */
  verifiedScript?: {
    sha256: string;
    status: "full" | "reused" | "unavailable";
    bytes?: number;
  };
  /** Root session of the request's ancestry (additive; absent when lineage was
   *  unavailable). */
  rootSessionID?: string;
  /** Overall evidence completeness for the request (additive). */
  evidenceCompleteness?: string;
  /** Resolved actor snapshot for audit (additive). Uses identityCompleteness
   *  (not the decision's numeric confidence) to avoid field ambiguity; v2 also
   *  carries identitySource + confidence. */
  actor?: {
    name?: string;
    mode?: string;
    profile: ActorProfile;
    identityCompleteness: "complete" | "partial" | "unknown";
    /** How the agent identity was established (tool-message, session-api,
     *  unavailable, …). Absent on legacy v1 records. */
    identitySource?: string;
    /** Reliability of the identity claim. Absent on legacy v1 records. */
    confidence?: EvidenceConfidence;
    delegationDepth?: number;
  };
  ssh?: Array<{
    destination: string;
    port?: string;
    remoteCommandSha256?: string;
    stdinSource?: string;
    stdinStatus?: string;
    stdinReason?: string;
  }>;
  /** Additive capability snapshot for audit (observe-only). */
  capability?: {
    actionClass: string;
    summary: string;
    parserCompleteness: string;
    executesCode?: boolean;
    createsAdHocCode?: boolean;
    invokesPackageLifecycleScripts?: boolean;
    writeEffects?: {
      temporaryWrite?: boolean;
      workspaceWrite?: boolean;
      externalWrite?: boolean;
      deletion?: boolean;
    };
    networkObserved?: boolean;
    credentialRead?: boolean;
    privilegeEscalation?: boolean;
    persistence?: boolean;
    remoteEnabled?: boolean;
    gitMutation?: boolean;
  };
  /** Additive policy trace for audit (observe-only). */
  policyTrace?: {
    effectivePolicyHash: string;
    matchedRules: Array<{
      id: string;
      source: string;
      effect: string;
      reason: string;
    }>;
    finalRoute: string;
    mode: string;
  };
  /** Additive snapshot of the ask decisions surfaced to the reviewer prompt
   *  (observe-only; capped to the most recent few). */
  askDecisions?: Array<{ at: number; question: string; answer: string }>;
}
