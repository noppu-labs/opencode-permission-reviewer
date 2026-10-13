import { resolveConfig } from "../../src/config.ts";
import { ReviewAttempt } from "../../src/core/review-attempt.ts";
import { SystemOneReviewerBackend } from "../../src/system-one/backend.ts";
import type { SystemOnePrimaryBasis } from "../../src/system-one/system-one-types.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
  SystemOneEscalationMode,
} from "../../src/types.ts";

// Deliberately a hand copy, not SYSTEM_ONE_BASES: it is the only test pin of the 11-basis
// wire contract (parseChoice's exactKeys).
export const PRIMARY_BASES: readonly SystemOnePrimaryBasis[] = [
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
];

export const choice = (
  selected: string,
  keys: readonly string[],
  confidence = 1,
): {
  type: string;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
} => {
  const remainder = (1 - confidence) / (keys.length - 1);
  return {
    type: "choice",
    choice: selected,
    confidence,
    probabilities: Object.fromEntries(
      keys.map((key) => [key, key === selected ? confidence : remainder]),
    ),
  };
};

export function response(overrides: Record<string, unknown> = {}): {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
} {
  const answers: Record<string, unknown> = {
    outcome: choice("allow", ["allow", "deny", "escalate"]),
    risk_level: choice("low", ["low", "medium", "high", "critical"]),
    user_authorization: choice("high", ["high", "medium", "low", "unknown"]),
    scope_alignment: choice("aligned", [
      "aligned",
      "partial",
      "misaligned",
      "unknown",
    ]),
    evidence_completeness: choice("sufficient", [
      "sufficient",
      "partial",
      "insufficient",
      "unknown",
    ]),
    primary_basis: choice("authorized_routine", PRIMARY_BASES),
    material_authorization: { type: "noul", noul: 1 },
    within_intent_scope: { type: "noul", noul: 1 },
    unauthorized_data_loss: { type: "noul", noul: 0 },
    untrusted_sensitive_disclosure: { type: "noul", noul: 0 },
    excessive_credential_access: { type: "noul", noul: 0 },
    unauthorized_security_change: { type: "noul", noul: 0 },
    unauthorized_external_mutation: { type: "noul", noul: 0 },
    essential_evidence_missing: { type: "noul", noul: 0 },
    absolute_policy_deny: { type: "noul", noul: 0 },
    ...overrides,
  };
  return {
    model: "jev-1.13.0",
    answers,
    usage: { input_tokens: 10, output_tokens: 0 },
  };
}

export const JEV_MODEL = "opencode/jev-1.13-free";
export const REASONING_MODEL = "openai/gpt-5.6-luna";
const OUTCOMES = ["allow", "deny", "escalate"] as const;
export const RISKS = ["low", "medium", "high", "critical"] as const;
const SCOPES = ["aligned", "partial", "misaligned", "unknown"] as const;

export const noul = (value: number): { type: string; noul: number } => ({
  type: "noul",
  noul: value,
});

type JevAnswerName =
  | "cleanAllow"
  | "cleanDeny"
  | "uncertainAllow"
  | "uncertainGatedAllow"
  | "clearEscalate"
  | "plausibleEscalate"
  | "criticalGatedAllow"
  | "misalignedGatedAllow"
  | "uncertainDeny";

/** Jev answers for each row of the spec's routing table. */
export const JEV_ANSWERS: Record<JevAnswerName, Record<string, unknown>> = {
  cleanAllow: {},
  cleanDeny: {
    outcome: choice("deny", OUTCOMES),
    primary_basis: choice("destructive_effect", PRIMARY_BASES),
  },
  // A restrictive basis on an allow is a contradiction.
  uncertainAllow: {
    primary_basis: choice("destructive_effect", PRIMARY_BASES),
  },
  uncertainGatedAllow: {
    primary_basis: choice("destructive_effect", PRIMARY_BASES),
    risk_level: choice("critical", RISKS),
  },
  // P(allow) + P(deny) = 0, below the 0.38 threshold.
  clearEscalate: { outcome: choice("escalate", OUTCOMES) },
  // P(allow) + P(deny) = 0.4, at or above the threshold.
  plausibleEscalate: { outcome: choice("escalate", OUTCOMES, 0.6) },
  // Consistent allows that a deterministic gate stops.
  criticalGatedAllow: { risk_level: choice("critical", RISKS) },
  misalignedGatedAllow: {
    scope_alignment: choice("misaligned", SCOPES),
    within_intent_scope: noul(0.5),
  },
  // Outcome confidence 0.35 is below systemOneConfidenceThreshold 0.4.
  uncertainDeny: {
    outcome: choice("deny", OUTCOMES, 0.35),
    primary_basis: choice("destructive_effect", PRIMARY_BASES),
  },
};

/** Jev's answer overrides, or an invalid answer, or a thrown transport error. */
export type JevScript = Record<string, unknown> | "invalid" | "failure";

function jevInvoke(script: JevScript): () => Promise<unknown> {
  if (script === "invalid")
    return async (): Promise<unknown> => ({ ...response(), model: "not-jev" });
  if (script === "failure")
    return async (): Promise<unknown> => {
      throw new Error("synthetic transport failure");
    };
  return async (): Promise<unknown> => response(script);
}

/** A Jev config with a reasoning reviewer and the two routing settings. */
export function routingConfig(
  systemOneEscalation: SystemOneEscalationMode,
  systemOneDenialReview = false,
  overrides: Record<string, unknown> = {},
): ReviewerConfig {
  return resolveConfig({
    model: JEV_MODEL,
    escalationReviewer: { model: REASONING_MODEL },
    systemOneEscalation,
    systemOneDenialReview,
    ...overrides,
  });
}

export const REASONING_DENY: ReviewExecutionResult = {
  kind: "deny",
  reason: "Reasoning reviewer denied the action.",
  decisionSource: "llm-reviewer",
};

export function reasoningAllow(
  evidence: "sufficient" | "partial",
  rationale = "The action is supported by complete evidence.",
): ReviewExecutionResult {
  return {
    kind: "allow",
    reason: rationale,
    decisionSource: "llm-reviewer",
    reviewerOutcome: "allow",
    decision: {
      version: 2,
      outcome: "allow",
      risk_level: "low",
      user_authorization: "high",
      scope_alignment: "aligned",
      evidence_completeness: evidence,
      rationale,
      confidence: 0.95,
    },
  };
}

export const REASONING_ESCALATE: ReviewExecutionResult = {
  kind: "escalate",
  reason: "The reasoning reviewer wants a person to decide.",
  decisionSource: "llm-reviewer",
  reviewerOutcome: "escalate",
};

/** What a reasoning backend returns after its own timeout: already disposed. */
export const REASONING_UNAVAILABLE: ReviewExecutionResult = {
  kind: "escalate",
  reason: "reviewer backend failed (TimeoutError): synthetic reasoning timeout",
  decisionSource: "failure-safe",
  escalationDisposition: "manual",
};

/** A backend whose Jev answers per `jev` and whose reasoning reviewer
 *  returns `reasoning`, counting the reasoning calls. */
export function routedBackend(
  config: ReviewerConfig,
  jev: JevScript,
  reasoning: () => Promise<ReviewExecutionResult> = async (): Promise<ReviewExecutionResult> =>
    REASONING_DENY,
): { backend: SystemOneReviewerBackend; calls: () => number } {
  let calls = 0;
  const backend = new SystemOneReviewerBackend(
    config,
    (): Promise<ReviewExecutionResult> => {
      calls++;
      return reasoning();
    },
    REASONING_MODEL,
    jevInvoke(jev),
  );
  return { backend, calls: () => calls };
}

export function envelope(): ReviewEnvelope {
  return {
    request: {
      id: "req_system_one",
      sessionID: "ses_system_one",
      permission: "bash",
      patterns: ["printf ok"],
      metadata: { command: "printf ok" },
      always: [],
    },
    directory: "/workspace",
    worktree: "/workspace",
    transcript: "USER: Run the harmless marker command.",
    intentHistory: "Run the harmless marker command.",
    enrichment: "",
    sshAudit: [],
  };
}

/** One review on a 60 s attempt (above the hand-off floor), closed after. */
export async function reviewOnce(
  backend: SystemOneReviewerBackend,
  attempt = new ReviewAttempt("generation", 60_000),
): Promise<ReviewExecutionResult> {
  try {
    return await backend.review(envelope(), attempt);
  } finally {
    attempt.close("finished");
  }
}

/** A 60 s attempt on a fixed clock that has `remainingMs` left. The caller
 *  closes it (reviewOnce does). */
export function attemptWithRemaining(remainingMs: number): ReviewAttempt {
  let now = 0;
  const budget = 60_000;
  const attempt = new ReviewAttempt("generation", budget, () => now);
  now = budget - remainingMs;
  return attempt;
}
