import { ReviewAttempt } from "../../src/core/review-attempt.ts";
import { evaluateReview } from "../../src/core/review-engine.ts";
import { SystemOneReviewerBackend } from "../../src/system-one/backend.ts";
import type { SystemOnePrimaryBasis } from "../../src/system-one/system-one-types.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../src/types.ts";

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

function envelope(): ReviewEnvelope {
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

export function reviewOnce(
  backend: SystemOneReviewerBackend,
): Promise<ReviewExecutionResult> {
  return backend.review(envelope(), new ReviewAttempt("generation", 10_000));
}

export function reasoningAllow(
  evidence: "sufficient" | "partial",
  rationale: string,
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

// An explicit Jev escalation at 0.6 is plausible enough to hand to reasoning.
export function escalatingJevBackend(
  config: ReviewerConfig,
  reasoning: ReviewExecutionResult,
): SystemOneReviewerBackend {
  return new SystemOneReviewerBackend(
    config,
    async () => reasoning,
    "openai/gpt-5.6-luna",
    async () =>
      response({
        outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
      }),
  );
}

// Incomplete action evidence makes the engine's allow gate downgrade any allow.
export function reviewWithIncompleteEvidence(
  config: ReviewerConfig,
  backend: SystemOneReviewerBackend,
): Promise<ReviewExecutionResult> {
  const pending = envelope();
  return evaluateReview(pending.request, config, {
    collect: async () => ({ ...pending, actionEvidenceComplete: false }),
    review: (value: ReviewEnvelope) =>
      backend.review(value, new ReviewAttempt("generation", 10_000)),
    active: () => true,
    auxiliarySession: () => false,
    observe: () => {},
  });
}

export async function withSyntheticCommandCodeKey<T>(
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = "synthetic-commandcode-key";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
}
