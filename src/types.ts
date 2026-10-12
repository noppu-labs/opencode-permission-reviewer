import type {
  ActionPurpose,
  ActorContext,
  AskDecision,
  EvidenceCompleteness,
  IntentContext,
  SessionLineage,
} from "./actor-context-types.ts";
import type { DecisionSource, ReviewAuditRecord } from "./audit-record.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
} from "./capability/capability-types.ts";
import type { SystemOneScores } from "./system-one/system-one-types.ts";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type UserAuthorization = "high" | "medium" | "low" | "unknown";
export type ReviewOutcome = "allow" | "deny" | "escalate";
export type ScopeAlignment = "aligned" | "partial" | "misaligned" | "unknown";
export type EvidenceSufficiency =
  | "sufficient"
  | "partial"
  | "insufficient"
  | "unknown";
/** How final escalations are disposed after reviewer/policy/fail-safe produce them. */
export type EscalationMode = "manual" | "deny";
/** Effective disposition applied to an internal escalate result. */
export type EscalationDisposition = "manual" | "deny";

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

export interface PermissionToolSource {
  messageID: string;
  callID: string;
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: PermissionToolSource;
}

export interface MessageWithParts {
  info: Record<string, unknown> & {
    id?: string;
    role?: string;
    structured?: unknown;
  };
  parts: Array<Record<string, unknown>>;
}

/** Deterministic risk×authorization matrix that gates reviewer `allow`
 *  outcomes. For each risk level, lists the authorization levels that permit an
 *  auto-allow. An empty array means no authorization permits auto-allow at that
 *  risk (the action is escalated). Only ever RESTRICTS; deny/escalate are always
 *  preserved. */
export interface RiskPolicy {
  allow: {
    low: UserAuthorization[];
    medium: UserAuthorization[];
    high: UserAuthorization[];
    critical: UserAuthorization[];
  };
  minimumConfidence: number;
  onInvalidDecision: "manual" | "deny";
  onReviewerFailure: "manual" | "deny";
}

/** Conservative repository trust model. A repository cannot mark itself trusted
 *  through project configuration alone — trust comes from global config or an
 *  interactive decision stored outside the repo. */
export type RepositoryTrust = "trusted" | "untrusted" | "unknown";

/** A declarative policy condition: matches capability/actor facts. Every field
 *  is optional; the rule matches when ALL specified fields match. A missing
 *  `when` (or `{ always: true }`) makes the rule universal. */
export interface PolicyCondition {
  /** Explicit catch-all: valid only as the sole key. */
  always?: true;
  actionClass?: CapabilityActionClass[];
  actorProfile?: ActorProfile[];
  writesWorkspace?: boolean;
  writesExternal?: boolean;
  writesTemporary?: boolean;
  deletion?: boolean;
  executesCode?: boolean;
  createsAdHocCode?: boolean;
  packageManagement?: boolean;
  gitMutation?: boolean;
  networkObserved?: boolean;
  credentialRead?: boolean;
  privilegeEscalation?: boolean;
  remoteEnabled?: boolean;
  persistence?: boolean;
  repositoryTrust?: RepositoryTrust[];
}

/** A declarative rule that routes a request based on capability+actor facts.
 *  `when` is optional: omitting it (or `{ always: true }`) matches every
 *  request. An explicitly empty `when: {}` is rejected at load. */
export interface PolicyRule {
  id: string;
  source: "builtin" | "global" | "project" | "inline";
  when?: PolicyCondition;
  effect: "review" | "manual" | "deny" | "allow";
  reason: string;
}

/** The result of evaluating the declarative policy. */
export interface PolicyTrace {
  /** Stable hash of the effective rule set (not the matched rules) for audit
   *  reproducibility. */
  effectivePolicyHash: string;
  matchedRules: Array<{
    id: string;
    source: string;
    effect: string;
    reason: string;
  }>;
  /** The route the engine computed (counterfactual in observe mode: what enforce
   *  mode WOULD have done with the same facts and rules). */
  finalRoute: "review" | "manual" | "deny" | "allow";
  mode: "observe" | "enforce";
}

export type ReviewerOutputFormat = "json_schema" | "text";

export interface EscalationReviewerConfig {
  model: string;
  variant: string;
  outputFormat: ReviewerOutputFormat;
  timeoutMs: number;
}

export interface ReviewerConfig {
  model: string;
  variant: string;
  /** How the reviewer model returns its decision. `json_schema` requests
   *  OpenCode's structured-output format (requires provider support); `text`
   *  asks the model to emit JSON in plain text and parses it locally. */
  outputFormat: ReviewerOutputFormat;
  /** Optional reasoning reviewer for valid System One decisions that remain
   *  uncertain or conflict with deterministic review gates. */
  escalationReviewer?: EscalationReviewerConfig;
  /** Calibrated outcome-confidence floor for System One decisions. */
  systemOneConfidenceThreshold: number;
  /** Minimum combined non-escalate probability for routing an explicit
   *  System One escalation to the optional reasoning reviewer. */
  systemOneReasoningThreshold: number;
  timeoutMs: number;
  /** Total review budget, including context, queueing, and retries. */
  reviewBudgetMs?: number;
  maxContextChars: number;
  maxPartChars: number;
  maxEnrichmentChars: number;
  maxIntentChars: number;
  transcriptMessages: number;
  intentMessages: number;
  historyMessages: number;
  confidenceThreshold: number;
  retainReviewSessions: boolean;
  audit: boolean;
  auditPath?: string;
  policy?: string;
  debug: boolean;
  /** When "observe", actor evidence is collected and audited but never enforces
   *  new gates; "enforce" applies declarative policy routes. */
  enforcementMode: "observe" | "enforce";
  /**
   * How internal `escalate` results are disposed before UI/reply.
   * - `manual` (default): leave the request for a human (interactive mode).
   * - `deny`: convert every final escalation into a reject with rationale
   *   (non-interactive fail-closed). Never relaxes an explicit deny.
   */
  escalationMode: EscalationMode;
  /** Max hops when walking session parents (default 8). */
  maxSessionDepth: number;
  /** Max parent sessions fetched during lineage traversal. */
  maxParentSessions: number;
  /** Trusted name→profile mappings (empty by default; no mappings shipped). */
  actorProfiles: Record<string, ActorProfile>;
  /** Deterministic risk×authorization gate, configurable but defaults reproduce
   *  the previous hard-coded matrix exactly. */
  riskPolicy: RiskPolicy;
  /** Repository trust level derived from global config (never from project). */
  repositoryTrust: RepositoryTrust;
  /** Declarative policy rules (empty by default; observe mode audits the trace
   *  without enforcing). Project-sourced allow rules are rejected. */
  policyRules: PolicyRule[];
  /** Capture user answers to agent ask dialogs (question tool) and surface
   *  them to the reviewer as scoped authorization evidence. */
  askDecisions: boolean;
  /** Non-empty when a TRUSTED config source (global file, inline options)
   *  existed but could not be fully honored (malformed file, unreadable file,
   *  or rules dropped by validation). Degraded configs block automatic
   *  approval: restrictions may have been lost, so requests escalate instead. */
  configDegraded?: string[];
}

export interface ReviewEnvelope {
  request: PermissionRequest;
  directory: string;
  worktree: string;
  transcript: string;
  intentHistory: string;
  enrichment: string;
  verifiedScript?: import("./verified-ssh-script.ts").VerifiedScriptEvidence;
  sshAudit: NonNullable<ReviewAuditRecord["ssh"]>;
  preflightDenial?: string;
  /** Agent-aware context (actor, lineage, intent). Observe-only: flows into the
   *  reviewer prompt and audit as evidence, never into enforcement decisions.
   *  Optional so older callers/tests still compile. */
  actor?: ActorContext;
  lineage?: SessionLineage;
  intent?: IntentContext;
  evidenceCompleteness?: EvidenceCompleteness;
  /** Structured capability facts derived from the bash command. Observe-only:
   *  feeds the reviewer prompt and audit, never enforcement. */
  capability?: CapabilityAssessment;
  /** The policy trace produced for this request, surfaced to the reviewer prompt
   *  as EFFECTIVE_POLICY_SUMMARY and to audit. Observe-only. */
  policyTrace?: PolicyTrace;
  /** Per-phase timing captured during evidence assembly (context/enrichment).
   *  The reviewer and reply phases are timed in the coordinator. */
  timings?: {
    contextMs?: number;
    enrichmentMs?: number;
    reviewerMs?: number;
    replyMs?: number;
  };
  /** False when a material part of the action under review (e.g. an elided
   *  command segment) never reached the rendered evidence. Blocking: the
   *  coordinator must not auto-approve an action the reviewer could not see
   *  in full, whatever confidence the model reports. */
  actionEvidenceComplete?: boolean;
  /** The parsed command reused across evidence providers. */
  parsedCommand?: ParsedCommand;
  /** Operational purpose of the pending action (evidence, never authorization). */
  actionPurpose?: ActionPurpose;
  /** User answers to agent ask dialogs in this session or its ancestors,
   *  captured live from question events. Observe-only: flows into the reviewer
   *  prompt (USER_ASK_DECISIONS) and audit, never into enforcement. */
  askDecisions?: AskDecision[];
}

export interface ApprovedAnnotation {
  requestID: string;
  sessionID: string;
  decision: ReviewDecision;
}

export interface ReviewExecutionResult {
  kind: "allow" | "deny" | "escalate";
  decision?: ReviewDecision;
  reason: string;
  reviewSessionID?: string;
  /** Which layer produced this result; threaded into the audit record. */
  decisionSource?: DecisionSource;
  /** Actual model that produced the final reviewer decision. */
  reviewerModel?: string;
  /** Primary model and routing reason when a second reviewer was used. */
  reviewerEscalatedFrom?: { model: string; reason: string };
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
}

/** Generic policy templates, NOT automatic trust levels. */
export type ActorProfile =
  | "read-only"
  | "validation"
  | "workspace"
  | "operator"
  | "reviewer"
  | "unknown";

/** High-level classification of what the action does. */
export type CapabilityActionClass =
  | "read-only"
  | "workspace-write"
  | "temporary-write"
  | "external-write"
  | "destruction"
  | "code-execution"
  | "package-management"
  | "git-mutation"
  | "network"
  | "remote-operation"
  | "service-management"
  | "persistence"
  | "privilege-escalation"
  | "unknown";
