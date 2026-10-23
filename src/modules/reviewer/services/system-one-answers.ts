// Validation of Jev's answer set: the six choices and the nine noul signals.

import type { SystemOneSignals } from "../../../kernel/review-result.ts";
import { SYSTEM_ONE_BASES as BASES } from "../../../kernel/review-result.ts";
import { isRecord } from "../../../utils/is-record.ts";
import {
  finiteProbability,
  type ParsedChoice,
  parseChoice,
  SUPPORTING_TIE_TOLERANCE,
} from "./system-one-choices.ts";

const OUTCOMES = ["allow", "deny", "escalate"] as const;
const RISKS = ["low", "medium", "high", "critical"] as const;
const AUTHORIZATIONS = ["high", "medium", "low", "unknown"] as const;
const ALIGNMENTS = ["aligned", "partial", "misaligned", "unknown"] as const;
const COMPLETENESS = [
  "sufficient",
  "partial",
  "insufficient",
  "unknown",
] as const;

export interface ParsedAnswers {
  outcome: ParsedChoice<(typeof OUTCOMES)[number]>;
  risk: ParsedChoice<(typeof RISKS)[number]>;
  authorization: ParsedChoice<(typeof AUTHORIZATIONS)[number]>;
  alignment: ParsedChoice<(typeof ALIGNMENTS)[number]>;
  completeness: ParsedChoice<(typeof COMPLETENESS)[number]>;
  basis: ParsedChoice<(typeof BASES)[number]>;
  signals: SystemOneSignals;
}

function parseNoul(value: unknown): number | undefined {
  if (!isRecord(value)) return;
  const answer = value;
  return answer.type === "noul" && finiteProbability(answer.noul)
    ? answer.noul
    : undefined;
}

function parseSignals(
  answers: Record<string, unknown>,
): SystemOneSignals | undefined {
  const signals: { [K in keyof SystemOneSignals]: number | undefined } = {
    materialAuthorization: parseNoul(answers.material_authorization),
    withinIntentScope: parseNoul(answers.within_intent_scope),
    unauthorizedDataLoss: parseNoul(answers.unauthorized_data_loss),
    untrustedSensitiveDisclosure: parseNoul(
      answers.untrusted_sensitive_disclosure,
    ),
    excessiveCredentialAccess: parseNoul(answers.excessive_credential_access),
    unauthorizedSecurityChange: parseNoul(answers.unauthorized_security_change),
    unauthorizedExternalMutation: parseNoul(
      answers.unauthorized_external_mutation,
    ),
    essentialEvidenceMissing: parseNoul(answers.essential_evidence_missing),
    absolutePolicyDeny: parseNoul(answers.absolute_policy_deny),
  };
  if (Object.values(signals).some((value) => value === undefined)) return;
  return signals as SystemOneSignals;
}

/** Every answer parsed, or undefined when any choice or signal is invalid. */
export function parseAnswers(
  answers: Record<string, unknown>,
): ParsedAnswers | undefined {
  const outcome = parseChoice(answers.outcome, OUTCOMES);
  const risk = parseChoice(answers.risk_level, RISKS, SUPPORTING_TIE_TOLERANCE);
  const authorization = parseChoice(
    answers.user_authorization,
    AUTHORIZATIONS,
    SUPPORTING_TIE_TOLERANCE,
  );
  const alignment = parseChoice(
    answers.scope_alignment,
    ALIGNMENTS,
    SUPPORTING_TIE_TOLERANCE,
  );
  const completeness = parseChoice(
    answers.evidence_completeness,
    COMPLETENESS,
    SUPPORTING_TIE_TOLERANCE,
  );
  const basis = parseChoice(
    answers.primary_basis,
    BASES,
    SUPPORTING_TIE_TOLERANCE,
  );
  if (
    !outcome ||
    !risk ||
    !authorization ||
    !alignment ||
    !completeness ||
    !basis
  )
    return;
  const signals = parseSignals(answers);
  if (signals === undefined) return;
  return {
    outcome,
    risk,
    authorization,
    alignment,
    completeness,
    basis,
    signals,
  };
}
