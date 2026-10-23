// The actor-context prompt sections: actor identity, session lineage, intent blocks and evidence completeness.

import type {
  ActorContext,
  EvidenceCompleteness,
  IntentBlock,
  Provenanced,
  SessionLineage,
} from "../../../kernel/actor-context-types.ts";
import { keepMostRecentBlocks, stableJson } from "./prompt-budget.ts";

function provValue<T>(p: Provenanced<T> | undefined): T | "unavailable" {
  return p === undefined ? "unavailable" : p.value;
}

export function renderActor(actor: ActorContext, max: number): string {
  return stableJson(
    {
      agent: provValue(actor.agentName),
      mode: provValue(actor.mode),
      profile: provValue(actor.profile),
      identityCompleteness: actor.identityCompleteness,
      sessionID: actor.sessionID,
      parentSessionID: provValue(actor.parentSessionID),
      rootSessionID: provValue(actor.rootSessionID),
      delegationDepth: provValue(actor.delegationDepth),
    },
    max,
  );
}

export function renderLineage(lineage: SessionLineage, max: number): string {
  return stableJson(
    {
      origin: lineage.origin ?? "unknown",
      depth: lineage.depth,
      rootSessionID: lineage.rootSessionID,
      cycleDetected: lineage.cycleDetected,
      truncated: lineage.truncated,
      missingParents: lineage.missingParents,
      chain: lineage.nodes.map((n) => ({
        sessionID: n.sessionID,
        ...(n.actorName === undefined ? {} : { actor: n.actorName }),
        ...(n.mode === undefined ? {} : { mode: n.mode }),
      })),
    },
    max,
  );
}

export function renderIntentBlocks(
  blocks: IntentBlock[],
  max: number,
  limit = blocks.length,
): string {
  if (blocks.length === 0) return "<none />";
  const ordered = [...blocks].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
  const seen = new Set<string>();
  const distinct = ordered
    .reverse()
    .filter((block) => {
      const key = `${block.actor}:${block.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .reverse();
  return keepMostRecentBlocks(
    distinct.map(
      (block) =>
        `INTENT actor=${block.actor} session=${block.sessionID} message=${block.messageID}${block.createdAt === undefined ? "" : ` created=${block.createdAt}`}\n${block.text}`,
    ),
    max,
  );
}

export function renderCompleteness(
  c: EvidenceCompleteness,
  max: number,
): string {
  return stableJson(
    {
      overall: c.overall,
      actor: c.actor,
      lineage: c.lineage,
      directUserIntent: c.directUserIntent,
      delegatedTask: c.delegatedTask,
      purpose: c.purpose,
      capability: c.capability,
      ...(c.reasons.length === 0 ? {} : { reasons: c.reasons }),
    },
    max,
  );
}
