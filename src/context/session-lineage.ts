// Session ancestry walk: bounded, cycle-checked session.get traversal into a SessionLineage.

import type { SessionLineage, SessionNode } from "../actor-context-types.ts";
import type { ContextReader } from "../core/ports.ts";
import { invariant } from "../invariant.ts";
import { withTimeout } from "../opencode/transport.ts";
import type { ReviewerConfig } from "../types.ts";
import {
  bareSession,
  lineageOrigin,
  readSession,
  type SessionMetadata,
  toNode,
} from "./session-metadata.ts";

/** Bound for the resolver's metadata SDK calls: a hung session.get/messages
 *  must degrade to "unknown" instead of leaving the review pending forever. */
export const METADATA_TIMEOUT_MS = 10_000;

// --- session.get wrapper (resilient) ----------------------------------------

async function fetchSession(
  client: ContextReader,
  sessionID: string,
  directory: string,
): Promise<SessionMetadata | undefined> {
  try {
    const raw = await withTimeout(
      client.session(sessionID, directory),
      METADATA_TIMEOUT_MS,
    );
    if (typeof raw !== "object" || raw === null) return undefined;
    const data = raw as Record<string, unknown>;
    if (
      data.id !== sessionID ||
      (data.parentID !== undefined && typeof data.parentID !== "string")
    )
      return undefined;
    return readSession(sessionID, data);
  } catch {
    return undefined;
  }
}

// --- lineage walk -----------------------------------------------------------

/**
 * Walk session parents via `session.get`, bounded by `maxSessionDepth`/
 * `maxParentSessions` with mandatory cycle detection. Missing/unavailable
 * parents are recorded explicitly rather than aborting the walk.
 */
export async function walkLineage(
  client: ContextReader,
  sessionID: string,
  directory: string,
  config: ReviewerConfig,
): Promise<SessionLineage> {
  const nodes: SessionNode[] = [];
  const missingParents: string[] = [];
  const visited = new Set<string>();
  let cycleDetected = false;

  const current = await fetchSession(client, sessionID, directory);
  const fallback = bareSession(sessionID);
  const origin = lineageOrigin(current);
  nodes.push(toNode(current ?? fallback));
  visited.add(sessionID);

  let cursor = current;
  let depth = 0;
  while (cursor?.parentID) {
    if (atConfiguredBound(depth, nodes.length - 1, config)) {
      // Hit a configured bound; remaining ancestry is truncated, not missing.
      return {
        ...finalize(
          nodes,
          cursor.parentID,
          depth,
          cycleDetected,
          true,
          missingParents,
        ),
        origin,
      };
    }
    if (visited.has(cursor.parentID)) {
      cycleDetected = true;
      missingParents.push(cursor.parentID);
      break;
    }
    visited.add(cursor.parentID);
    // biome-ignore lint/performance/noAwaitInLoops: walks the session ancestry one parent at a time; the next parentID is only known from the session fetched in this step
    const parent = await fetchSession(client, cursor.parentID, directory);
    if (!parent) {
      missingParents.push(cursor.parentID);
      break;
    }
    nodes.push(toNode(parent));
    depth += 1;
    cursor = parent;
  }
  return {
    ...finalize(nodes, undefined, depth, cycleDetected, false, missingParents),
    origin,
  };
}

function atConfiguredBound(
  depth: number,
  parentSessions: number,
  config: ReviewerConfig,
): boolean {
  return (
    depth >= config.maxSessionDepth ||
    parentSessions >= config.maxParentSessions
  );
}

function finalize(
  nodes: SessionNode[],
  nextUnresolved: string | undefined,
  depth: number,
  cycleDetected: boolean,
  truncated: boolean,
  missingParents: string[],
): SessionLineage {
  if (
    nextUnresolved !== undefined &&
    !missingParents.includes(nextUnresolved)
  ) {
    missingParents.push(nextUnresolved);
  }
  const root = nodes.at(-1);
  invariant(root, "walkLineage pushes the starting session before finalizing");
  return {
    nodes,
    rootSessionID: root.sessionID,
    depth,
    cycleDetected,
    truncated,
    missingParents,
  };
}
