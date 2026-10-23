import type { JsonValue, SystemOneResult } from "@typesafe-ai/sdk";
import type {
  ReviewDecision,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../../types.ts";
import { isRecord } from "../../../utils/is-record.ts";
import { enforceDecision } from "../../review/services/decision/decision-gates.ts";
import type { SystemOnePrimaryBasis } from "../models/system-one-types.ts";
import { type ParsedAnswers, parseAnswers } from "./system-one-answers.ts";
import { exactKeys } from "./system-one-choices.ts";
import { SYSTEM_ONE_QUESTIONS } from "./system-one-questions.ts";
import {
  type ParsedSystemOneReview,
  systemOneVerdict,
} from "./system-one-verdict.ts";

export interface SystemOneState extends Record<string, JsonValue> {
  trustedPolicy: { reviewer: string; tenant: string };
  untrustedEvidence: string;
}

const BASIS_RATIONALE: Record<SystemOnePrimaryBasis, string> = {
  authorized_routine:
    "The action is routine, narrow, and adequately authorized.",
  authorized_reversible_change:
    "The action is a bounded, reversible change with sufficient authorization.",
  insufficient_authorization:
    "The available human authorization is insufficient for the action.",
  scope_mismatch: "The action is not fully aligned with the stated scope.",
  insufficient_evidence: "Material evidence is insufficient or contradictory.",
  destructive_effect:
    "The action has a material destructive or disruptive effect.",
  credential_or_private_data:
    "The action creates an unsafe credential, secret, or private-data exposure.",
  security_or_privilege_change:
    "The action changes security, privilege, or persistence without adequate authorization.",
  external_or_remote_effect:
    "The external or remote effect is not supported by sufficiently specific authorization.",
  trusted_policy_restriction:
    "The trusted tenant policy restricts this action.",
  conflicting_evidence:
    "Material authorization, scope, or evidence signals conflict.",
};

function reviewDecision(answers: ParsedAnswers): ReviewDecision {
  return {
    version: 2,
    outcome: answers.outcome.choice,
    risk_level: answers.risk.choice,
    user_authorization: answers.authorization.choice,
    scope_alignment: answers.alignment.choice,
    evidence_completeness: answers.completeness.choice,
    rationale: BASIS_RATIONALE[answers.basis.choice],
    confidence: answers.outcome.confidence,
  };
}

/** The response's model and answers, when the model is one `config` accepts
 *  and the answers cover exactly the fixed questions. */
function responseAnswers(
  response: unknown,
  config: ReviewerConfig,
): { model: string; answers: Record<string, unknown> } | undefined {
  if (!isRecord(response)) return;
  const raw = response;
  if (
    typeof raw.model !== "string" ||
    (config.model === "commandcode/typesafe/jev"
      ? raw.model !== "typesafe/jev"
      : !/^jev(?:-|$)/.test(raw.model))
  )
    return;
  if (!isRecord(raw.answers)) return;
  const answers = raw.answers;
  if (!exactKeys(answers, Object.keys(SYSTEM_ONE_QUESTIONS))) return;
  return { model: raw.model, answers };
}

export function parseSystemOneReview(
  response: SystemOneResult<typeof SYSTEM_ONE_QUESTIONS> | unknown,
  config: ReviewerConfig,
): ParsedSystemOneReview | undefined {
  const raw = responseAnswers(response, config);
  if (raw === undefined) return;
  const answers = parseAnswers(raw.answers);
  if (answers === undefined) return;
  return systemOneVerdict(answers, reviewDecision(answers), raw.model, config);
}

export function enforceSystemOneDecision(
  decision: ReviewDecision,
  config: ReviewerConfig,
): ReviewExecutionResult {
  return enforceDecision(decision, {
    ...config,
    confidenceThreshold: 0,
    riskPolicy: { ...config.riskPolicy, minimumConfidence: 0 },
  });
}

export function enforceParsedSystemOneReview(
  parsed: ParsedSystemOneReview,
  config: ReviewerConfig,
): ReviewExecutionResult {
  const enforced = enforceSystemOneDecision(parsed.decision, config);
  if (parsed.difficultReason === undefined || enforced.kind === "deny")
    return enforced;
  return {
    kind: "escalate",
    decision: parsed.decision,
    reason: parsed.difficultReason,
    reviewerOutcome: parsed.decision.outcome,
  };
}
