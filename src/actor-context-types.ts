// Actor, lineage, intent and evidence-completeness types carried alongside a permission request.

import type { ActorProfile } from "./types.ts";

// Observe-only by default: these types reach the reviewer prompt and the
// audit record, and drive declarative policy routes only under
// `enforcementMode: "enforce"`; the decision schema and `enforceDecision`
// never read them.

/** Reliability of a derived fact. */
export type EvidenceConfidence =
  | "confirmed"
  | "high"
  | "medium"
  | "low"
  | "unknown";

/** Every non-trivial derived fact carries provenance so the LLM and audit can
 *  weigh claims by how reliably they were established. */
export interface Provenanced<T> {
  value: T;
  source:
    | "permission-event"
    | "tool-message"
    | "session-api"
    | "parent-session"
    | "global-config"
    | "project-config"
    | "effective-permissions"
    | "static-analysis"
    | "heuristic"
    | "unavailable";
  confidence: EvidenceConfidence;
  notes?: string[];
}

/** Normalized effective-permission summary when the SDK exposes it.
 *  The v1 SDK does not expose effective rules, so this stays `undefined`. */
export interface EffectivePermissionSummary {
  edit: "allow" | "ask" | "deny" | "mixed" | "unknown";
  bash: "allow" | "ask" | "deny" | "mixed" | "unknown";
  task: "allow" | "ask" | "deny" | "mixed" | "unknown";
  externalDirectory: "allow" | "ask" | "deny" | "mixed" | "unknown";
  source: "session" | "agent-config" | "derived" | "unknown";
}

/** Who is requesting the permission. */
export interface ActorContext {
  agentName: Provenanced<string | undefined>;
  mode: Provenanced<string | undefined>;
  profile: Provenanced<ActorProfile>;
  sessionID: string;
  parentSessionID: Provenanced<string | undefined>;
  rootSessionID: Provenanced<string>;
  delegationDepth: Provenanced<number>;
  effectivePermissions?: EffectivePermissionSummary;
  identityCompleteness: "complete" | "partial" | "unknown";
}

/** A node in the session ancestry chain. */
export interface SessionNode {
  sessionID: string;
  parentID?: string;
  title?: string;
  version?: string;
  actorName?: string;
  mode?: string;
  createdAt?: number;
}

/** The resolved session ancestry with failure modes made explicit. */
export interface SessionLineage {
  origin?: "human-root" | "delegated" | "unknown";
  nodes: SessionNode[];
  rootSessionID: string;
  depth: number;
  cycleDetected: boolean;
  truncated: boolean;
  missingParents: string[];
}

/** A single authorization/intent statement. */
export interface IntentBlock {
  sessionID: string;
  messageID: string;
  actor: "user" | "assistant" | "system" | "unknown";
  text: string;
  synthetic: boolean;
  createdAt?: number;
  provenance: Provenanced<"intent">;
}

/** One user decision on an agent-initiated ask dialog (question tool). The
 *  question text is agent-generated and untrusted; only the answer is a user
 *  authorization signal, scoped to the subject and time of the ask. */
export interface AskDecision {
  /** Epoch ms when the reply (or dismissal) was observed. */
  at: number;
  /** What the agent asked, already redacted and truncated. */
  question: string;
  /** The option labels the user selected, or a dismissal marker. */
  answer: string;
}

/** Direct user intent kept separate from delegated task. */
export interface IntentContext {
  directUserIntent: IntentBlock[];
  delegatedTask: IntentBlock[];
  localSessionIntent: IntentBlock[];
  conflictingInstructions: string[];
  latestExplicitAuthorization?: IntentBlock;
  completeness: "complete" | "partial" | "insufficient";
}

/** Meta-summary of what evidence was available. */
export interface EvidenceCompleteness {
  permission: boolean;
  actor: boolean;
  lineage: boolean;
  directUserIntent: boolean;
  delegatedTask: boolean;
  /** Whether a non-unavailable ACTION_PURPOSE was recovered. */
  purpose: boolean;
  capability: boolean;
  repositoryState: boolean;
  referencedCode: boolean;
  reasons: string[];
  overall: "sufficient" | "partial" | "insufficient";
}

/**
 * Operational purpose of the pending action — what the agent appears to be
 * trying to accomplish. This is untrusted evidence: it never demonstrates
 * user authorization by itself.
 */
export interface ActionPurpose {
  text?: string;
  source: "agent-context" | "intent-derived" | "unavailable";
  confidence: EvidenceConfidence;
}
