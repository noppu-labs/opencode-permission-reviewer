import type { UserAuthorization } from "./review-decision.ts";

/** How final escalations are disposed after reviewer/policy/fail-safe produce them. */
export type EscalationMode = "manual" | "deny";

/** Where an escalation that starts at Jev goes; `reasoning-first` sends every one to the escalation reviewer. */
export type SystemOneEscalationMode = "standard" | "reasoning-first";

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
  /** Read through resolveSystemOneRouting, which applies the Jev and escalationReviewer conditions. */
  systemOneEscalation: SystemOneEscalationMode;
  /** Send uncertain Jev denials to the escalation reviewer. Read through resolveSystemOneRouting. */
  systemOneDenialReview: boolean;
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
  /** Non-empty when a setting was invalid and fell back to its default, or is
   *  on but inert. Informational only: never affects a decision. */
  configWarnings?: string[];
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
