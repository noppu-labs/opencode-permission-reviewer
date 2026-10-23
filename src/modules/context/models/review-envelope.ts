import type {
  ActionPurpose,
  ActorContext,
  AskDecision,
  EvidenceCompleteness,
  IntentContext,
  SessionLineage,
} from "../../../kernel/actor-context-types.ts";
import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { PolicyTrace } from "../../../kernel/reviewer-config.ts";
import type {
  CapabilityAssessment,
  ParsedCommand,
} from "../../analysis/capability/models/capability-types.ts";
import type { SshAuditSummary } from "../../evidence/ssh/ssh-evidence.ts";

export interface ReviewEnvelope {
  request: PermissionRequest;
  directory: string;
  worktree: string;
  transcript: string;
  intentHistory: string;
  enrichment: string;
  verifiedScript?: import("../../evidence/ssh/verified-ssh-script.ts").VerifiedScriptEvidence;
  sshAudit: SshAuditSummary[];
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
