// Who decided, and why the reasoning reviewer ran, as the TUI shows it.

import type { HandoffInfo } from "../kernel/review-handoff.ts";
import type { HandoffTrigger } from "../kernel/review-result.ts";
import type { ReviewUiStatus } from "../modules/status/models/ui-protocol.ts";

type PhraseSource = Pick<
  ReviewUiStatus,
  "handoff" | "phase" | "resolution" | "escalationDisposition"
>;

const AFTER: Record<
  Exclude<HandoffTrigger, "jev-failure" | "jev-uncertain-deny">,
  string
> = {
  "jev-escalate": "after Jev's escalation",
  "jev-uncertain-allow": "after Jev's uncertain approval",
  "jev-gate": "after a safety gate stopped Jev's approval",
  "jev-invalid": "after Jev's invalid response",
};

const CAUSE: Record<Exclude<HandoffTrigger, "jev-failure">, string> = {
  "jev-escalate": "Jev escalated",
  "jev-uncertain-allow": "Jev's approval was uncertain",
  "jev-gate": "a safety gate stopped Jev's approval",
  "jev-invalid": "Jev's response was invalid",
  "jev-uncertain-deny": "Jev's denial was uncertain",
};

/** Last path segment of a provider model id: "omniroute/auto/gpt-6-luna" -> "gpt-6-luna". */
export function shortModelName(model: string): string {
  const segments = model
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.at(-1) ?? "";
}

/** The last non-blank path segment, or the whole id when there is none ("///"). */
export function modelLabel(model: string): string {
  return shortModelName(model) || model;
}

const jevFailed = (kind: string | undefined): string =>
  kind === undefined ? "Jev failed" : `Jev failed (${kind})`;

/** A "denied" phase with `escalationDisposition: "deny"` is a fail-closed
 *  escalation, not the reasoning reviewer's own block, so it does not confirm
 *  Jev's denial. */
function denialVerdict(status: PhraseSource): string {
  if (status.phase === "approved") return "overturned Jev's denial";
  if (status.phase === "denied" && status.escalationDisposition !== "deny")
    return "confirmed Jev's denial";
  return "after Jev's uncertain denial";
}

/** Undefined on `budget-exhausted` (the reasoning reviewer never ran) and on
 *  `reasoning-unavailable` (it made no decision). */
export function handoffPhrase(status: PhraseSource): string | undefined {
  const { handoff } = status;
  if (
    handoff === undefined ||
    status.resolution === "budget-exhausted" ||
    status.resolution === "reasoning-unavailable"
  )
    return;
  if (handoff.trigger === "jev-failure")
    return `after ${jevFailed(handoff.failureKind)}`;
  if (handoff.trigger === "jev-uncertain-deny") return denialVerdict(status);
  return AFTER[handoff.trigger];
}

/** `decidedBy`, except a `budget-exhausted` status that carries a hand-off,
 *  which credits `status.model`: the reasoning reviewer never ran. */
function creditedModel(status: ReviewUiStatus): string | undefined {
  if (status.handoff !== undefined && status.resolution === "budget-exhausted")
    return status.model;
  return status.decidedBy;
}

/** Line 2's attribution; undefined when no model is credited. */
export function attributionText(status: ReviewUiStatus): string | undefined {
  const phrase = handoffPhrase(status);
  if (phrase !== undefined && status.handoff !== undefined)
    return `${modelLabel(status.handoff.to)} ${phrase}`;
  const model = modelLabel(creditedModel(status) ?? "");
  return model === "" ? undefined : model;
}

/** Why Jev handed off, for the budget toast ("Jev timed out"). */
export function handoffCause(handoff: HandoffInfo): string {
  if (handoff.trigger !== "jev-failure") return CAUSE[handoff.trigger];
  return handoff.failureKind === "timeout"
    ? "Jev timed out"
    : jevFailed(handoff.failureKind);
}

/** The progress strip's reviewer: the hand-off while the reasoning reviewer
 *  runs, else the model's label. */
export function reviewerLabel(status: ReviewUiStatus): string {
  if (status.handoff === undefined) return modelLabel(status.model);
  return attributionText(status) ?? modelLabel(status.model);
}

/** Result strip line 2: "<attribution> — <reason>". The reason alone when no
 *  model decided or the status is unknown; undefined without a reason. */
export function resultDetail(status: ReviewUiStatus): string | undefined {
  if (!status.reason) return;
  const attribution =
    status.phase === "unknown" ? undefined : attributionText(status);
  return attribution === undefined
    ? status.reason
    : `${attribution} — ${status.reason}`;
}
