// Intent assessment: the latest explicit authorization, the reasons intent is incomplete, and the completeness grade.

import type {
  IntentBlock,
  IntentContext,
  SessionLineage,
} from "../models/actor-context-types.ts";

/** Pick by creation time, not by array position: the intent arrays are
 *  concatenated local → parent → root, so the last element is the root's
 *  latest message even when the current session holds much newer input. When
 *  no block carries a timestamp, fall back to the last recovered block. */
export function latestAuthorization(
  directUserIntent: IntentBlock[],
): IntentBlock | undefined {
  const timestamped = directUserIntent.filter(
    (block) => block.createdAt !== undefined,
  );
  return timestamped.length > 0
    ? /* NOSONAR(S6959) guarded by `timestamped.length > 0`, so the array is never empty */ timestamped.reduce(
        (best, block) =>
          (block.createdAt ?? 0) > (best.createdAt ?? 0) ? block : best,
      )
    : directUserIntent[directUserIntent.length - 1];
}

export function intentReasons(
  lineage: SessionLineage,
  delegatedTask: IntentBlock[],
  directUserIntent: IntentBlock[],
  currentDelegated: boolean,
): string[] {
  const reasons: string[] = [];
  if (delegatedTask.length === 0 && lineage.depth > 0)
    reasons.push("no delegation subtask located in parent session");
  if (lineage.missingParents.length > 0)
    reasons.push(`missing parents: ${lineage.missingParents.join(", ")}`);
  if (directUserIntent.length === 0)
    reasons.push(
      currentDelegated
        ? "delegated session: no human-authored user messages exist in this session chain window"
        : "no direct user intent recovered",
    );
  return reasons;
}

export function intentCompleteness(
  directUserIntent: IntentBlock[],
  delegatedTask: IntentBlock[],
  localSessionIntent: IntentBlock[],
  currentDelegated: boolean,
): IntentContext["completeness"] {
  return directUserIntent.length > 0 &&
    (delegatedTask.length > 0 || !currentDelegated)
    ? "complete"
    : directUserIntent.length > 0 || localSessionIntent.length > 0
      ? "partial"
      : "insufficient";
}
