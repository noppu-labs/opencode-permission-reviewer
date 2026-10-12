// Session metadata: a session.get payload read into typed fields, the bare stand-in for an unreadable session, its lineage origin and its lineage node.

import type { SessionLineage, SessionNode } from "../actor-context-types.ts";

export interface SessionMetadata {
  id: string;
  parentID: string | undefined;
  title: string | undefined;
  version: string | undefined;
  agent: string | undefined;
  mode: string | undefined;
  createdAt: number | undefined;
}

export function readSession(id: string, raw: unknown): SessionMetadata {
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

export function toNode(s: SessionMetadata): SessionNode {
  const node: SessionNode = { sessionID: s.id };
  if (s.parentID !== undefined) node.parentID = s.parentID;
  if (s.title !== undefined) node.title = s.title;
  if (s.version !== undefined) node.version = s.version;
  if (s.agent !== undefined) node.actorName = s.agent;
  if (s.mode !== undefined) node.mode = s.mode;
  if (s.createdAt !== undefined) node.createdAt = s.createdAt;
  return node;
}

/** The stand-in for a starting session whose metadata could not be read. */
export function bareSession(id: string): SessionMetadata {
  return {
    id,
    parentID: undefined,
    title: undefined,
    version: undefined,
    agent: undefined,
    mode: undefined,
    createdAt: undefined,
  };
}

export function lineageOrigin(
  current: SessionMetadata | undefined,
): NonNullable<SessionLineage["origin"]> {
  if (current === undefined) return "unknown";
  return current.parentID !== undefined ? "delegated" : "human-root";
}
