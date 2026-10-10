// Session ancestry walk: bounded, cycle-checked session.get traversal into a SessionLineage.

import type { SessionLineage, SessionNode } from "../actor-context-types.ts";
import type { ContextReader } from "../core/ports.ts";
import { invariant } from "../invariant.ts";
import { withTimeout } from "../opencode/transport.ts";
import type { ReviewerConfig } from "../types.ts";

/** Bound for the resolver's metadata SDK calls: a hung session.get/messages
 *  must degrade to "unknown" instead of leaving the review pending forever. */
export const METADATA_TIMEOUT_MS = 10_000;

// --- session.get wrapper (resilient) ----------------------------------------

interface SessionMetadata {
  id: string;
  parentID: string | undefined;
  title: string | undefined;
  version: string | undefined;
  agent: string | undefined;
  mode: string | undefined;
  createdAt: number | undefined;
}

function readSession(id: string, raw: unknown): SessionMetadata {
  const r = (raw ?? {}) as Record<string, unknown>;
  const parentID = typeof r.parentID === "string" ? r.parentID : undefined;
  return {
    id,
    parentID,
    title: typeof r.title === "string" ? r.title : undefined,
    version: typeof r.version === "string" ? r.version : undefined,
    agent: typeof r.agent === "string" ? r.agent : undefined,
    mode: typeof r.mode === "string" ? r.mode : undefined,
    createdAt:
      typeof r.time === "object" &&
      r.time !== null &&
      "created" in r.time &&
      typeof (r.time as Record<string, unknown>).created === "number"
        ? ((r.time as Record<string, unknown>).created as number)
        : undefined,
  };
}

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
  const fallback: SessionMetadata = {
    id: sessionID,
    parentID: undefined,
    title: undefined,
    version: undefined,
    agent: undefined,
    mode: undefined,
    createdAt: undefined,
  };
  const origin =
    current === undefined
      ? "unknown"
      : current.parentID !== undefined
        ? "delegated"
        : "human-root";
  nodes.push(toNode(current ?? fallback));
  visited.add(sessionID);

  let cursor = current;
  let depth = 0;
  while (cursor?.parentID) {
    if (
      depth >= config.maxSessionDepth ||
      nodes.length - 1 >= config.maxParentSessions
    ) {
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

function toNode(s: SessionMetadata): SessionNode {
  const node: SessionNode = { sessionID: s.id };
  if (s.parentID !== undefined) node.parentID = s.parentID;
  if (s.title !== undefined) node.title = s.title;
  if (s.version !== undefined) node.version = s.version;
  if (s.agent !== undefined) node.actorName = s.agent;
  if (s.mode !== undefined) node.mode = s.mode;
  if (s.createdAt !== undefined) node.createdAt = s.createdAt;
  return node;
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
