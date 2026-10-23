import type {
  EvidenceSufficiency,
  ReviewDecision,
  ScopeAlignment,
} from "../../kernel/review-decision.ts";
import { isRecord } from "../../utils/is-record.ts";

const OUTCOMES = new Set(["allow", "deny", "escalate"]);
const RISKS = new Set(["low", "medium", "high", "critical"]);
const AUTHORIZATIONS = new Set(["high", "medium", "low", "unknown"]);
const SCOPE_ALIGNMENTS = new Set([
  "aligned",
  "partial",
  "misaligned",
  "unknown",
]);
const EVIDENCE_SUFFICIENCY = new Set([
  "sufficient",
  "partial",
  "insufficient",
  "unknown",
]);

/**
 * Parse the reviewer's plain-text response under a strict, fail-closed policy:
 * the entire response must be exactly one JSON object, optionally wrapped in a
 * single Markdown code fence that encloses the whole response. Prose around
 * the object, multiple objects, multiple fences, or any trailing content make
 * the response ambiguous; ambiguity returns `undefined` so the request
 * escalates to a human. This component authorizes tool execution: when the
 * model's output is ambiguous it must never guess which candidate was meant.
 *
 * Text-mode flakiness is absorbed by the coordinator's corrective retry, not by
 * loosening this parser: a looser extractor could auto-approve a draft decision
 * that the model later reversed in prose. See the maintainer's rationale in the
 * commit that hardened this parser (reject ambiguous text-mode reviewer output).
 */
export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;

  let body = trimmed;
  // Accept one fence wrapping the ENTIRE response (``` or ```json) because
  // many models fence JSON even when told not to. The closing fence must be
  // the last thing in the response; anything before or after it rejects the
  // whole response instead of salvaging a candidate from inside.
  if (trimmed.startsWith("```")) {
    const fenceBody = trimmed.match(/^```[^\n]*\n?([\s\S]*?)\n?```\s*$/)?.[1];
    if (fenceBody === undefined) return;
    body = fenceBody.trim();
  }

  try {
    const parsed = JSON.parse(body);
    // Only a plain object is a candidate decision; arrays/primitives/`null`
    // are rejected so parseDecision never has to special-case them.
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}

/** Parse a plain-text reviewer response into a valid decision, if possible. */
export function parseDecisionFromText(
  text: string,
): ReviewDecision | undefined {
  return parseDecision(extractJsonFromText(text));
}

function isMember(members: ReadonlySet<string>, value: unknown): boolean {
  return typeof value === "string" && members.has(value);
}

function hasValidVerdict(value: Record<string, unknown>): boolean {
  return (
    isMember(OUTCOMES, value.outcome) &&
    isMember(RISKS, value.risk_level) &&
    isMember(AUTHORIZATIONS, value.user_authorization)
  );
}

function validRationale(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const rationale = value.trim();
  if (rationale.length < 3 || rationale.length > 2_000) return;
  return rationale;
}

function isValidConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isValidScriptAnalysis(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && value.length >= 20 && value.length <= 1500)
  );
}

function hasValidAssessment(value: Record<string, unknown>): boolean {
  return (
    isMember(SCOPE_ALIGNMENTS, value.scope_alignment) &&
    isMember(EVIDENCE_SUFFICIENCY, value.evidence_completeness)
  );
}

export function parseDecision(value: unknown): ReviewDecision | undefined {
  if (!isRecord(value)) return;
  // The current schema is version 2. A model output that omits the version
  // (or carries a different one) is rejected outright and routed to a human;
  // it never silently degrades to a guessed decision.
  if (value.version !== DECISION_SCHEMA_VERSION) return;
  if (!hasValidVerdict(value)) return;
  const rationale = validRationale(value.rationale);
  if (rationale === undefined) return;
  if (!isValidConfidence(value.confidence)) return;
  if (!isValidScriptAnalysis(value.script_analysis)) return;
  if (!hasValidAssessment(value)) return;

  return {
    version: DECISION_SCHEMA_VERSION,
    outcome: value.outcome as ReviewDecision["outcome"],
    risk_level: value.risk_level as ReviewDecision["risk_level"],
    user_authorization:
      value.user_authorization as ReviewDecision["user_authorization"],
    rationale,
    confidence: value.confidence,
    ...(value.script_analysis === undefined
      ? {}
      : { script_analysis: value.script_analysis as string }),
    scope_alignment: value.scope_alignment as ScopeAlignment,
    evidence_completeness: value.evidence_completeness as EvidenceSufficiency,
  };
}

export const DECISION_SCHEMA_VERSION = 2;
