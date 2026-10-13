// The single hand-off decision: whether a Jev result goes to the reasoning
// reviewer, under which trigger, and whether the attempt can still afford it.
import type { ReviewAttempt } from "../core/review-attempt.ts";
import type { SystemOneRouting } from "../system-one-routing.ts";
import type { HandoffTrigger, ReviewExecutionResult } from "../types.ts";
import type { SystemOneSignals } from "./system-one-types.ts";
import type { ParsedSystemOneReview } from "./system-one-verdict.ts";

/** The least review time a hand-off needs; with less the request escalates. */
export const HANDOFF_BUDGET_FLOOR_MS = 15_000;

/** What came back from Jev: a parsed and enforced verdict, an invalid
 *  answer, or a thrown error. */
export type JevOutcome =
  | {
      kind: "valid";
      parsed: ParsedSystemOneReview;
      enforced: ReviewExecutionResult;
    }
  | { kind: "invalid" }
  | { kind: "failure"; error: unknown };

/** A denial with a strong policy or safety signal is never second-guessed. */
function denialStaysFinal(signals: SystemOneSignals): boolean {
  return (
    signals.absolutePolicyDeny >= 0.7 ||
    Math.max(
      signals.unauthorizedDataLoss,
      signals.untrustedSensitiveDisclosure,
      signals.excessiveCredentialAccess,
      signals.unauthorizedSecurityChange,
      signals.unauthorizedExternalMutation,
    ) >= 0.5
  );
}

function denialTrigger(
  parsed: ParsedSystemOneReview,
  routing: SystemOneRouting,
): HandoffTrigger | undefined {
  if (!routing.denialReview || parsed.scores.contradictions.length === 0)
    return undefined;
  return denialStaysFinal(parsed.scores.signals)
    ? undefined
    : "jev-uncertain-deny";
}

/** An enforced escalation: Jev's own, a difficult allow, or a gated allow. */
function escalationTrigger(
  parsed: ParsedSystemOneReview,
  routing: SystemOneRouting,
): HandoffTrigger | undefined {
  if (parsed.decision.outcome === "escalate")
    return routing.reasoningFirst || parsed.reasoningRecommended
      ? "jev-escalate"
      : undefined;
  if (parsed.difficultReason !== undefined) return "jev-uncertain-allow";
  return routing.reasoningFirst ? "jev-gate" : undefined;
}

/** Why this Jev outcome goes to the reasoning reviewer, or undefined when
 *  it stays Jev's. */
export function handoffTrigger(
  jev: JevOutcome,
  routing: SystemOneRouting,
): HandoffTrigger | undefined {
  if (jev.kind !== "valid") {
    if (!routing.reasoningFirst) return undefined;
    return jev.kind === "invalid" ? "jev-invalid" : "jev-failure";
  }
  if (jev.enforced.kind === "allow") return undefined;
  if (jev.enforced.kind === "deny") return denialTrigger(jev.parsed, routing);
  return escalationTrigger(jev.parsed, routing);
}

/** Why a due hand-off cannot run, or undefined when it can. */
export function handoffBlock(
  attempt: ReviewAttempt,
): "inactive" | "budget-exhausted" | undefined {
  if (!attempt.active()) return "inactive";
  return attempt.remainingMs() < HANDOFF_BUDGET_FLOOR_MS
    ? "budget-exhausted"
    : undefined;
}
