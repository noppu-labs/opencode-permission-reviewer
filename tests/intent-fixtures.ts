// Fake ContextReader, lineage and resolveIntent call shared by the resolveIntent characterisation tests.

import type {
  IntentContext,
  SessionLineage,
  SessionNode,
} from "../src/actor-context-types.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { resolveIntent } from "../src/context/intent-extraction.ts";
import type { ContextReader } from "../src/core/ports.ts";
import type { MessageWithParts } from "../src/types.ts";
import { request } from "./helpers.ts";
import type { Part } from "./intent-builders.ts";

/** A fake reader that records each call; an `Error` reply is a rejection. */
export function fakeReader(
  messages: Part,
  intent: Part | undefined,
): { reader: ContextReader; calls: string[] } {
  const calls: string[] = [];
  const answer =
    (kind: string, replies: Part) =>
    (sessionID: string, directory: string, limit: number): Promise<unknown> => {
      calls.push(`${kind} ${sessionID} ${directory} ${limit}`);
      const reply = replies[sessionID] ?? [];
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(reply);
    };
  const reader: ContextReader = {
    messages: answer("messages", messages),
    session: () => Promise.reject(new Error("session is not read here")),
  };
  if (intent !== undefined)
    reader.intentMessages = answer("intentMessages", intent);
  return { reader, calls };
}

export function lineage(
  origin: NonNullable<SessionLineage["origin"]>,
  nodes: SessionNode[],
  missingParents: string[] = [],
): SessionLineage {
  return {
    origin,
    nodes,
    rootSessionID: nodes.at(-1)?.sessionID ?? CURRENT,
    depth: nodes.length - 1,
    cycleDetected: false,
    truncated: false,
    missingParents,
  };
}

export const CURRENT = "ses_current";

/** The result type adds `reasons`, which resolveIntent returns but IntentContext does not declare. */
export function resolve(
  reader: ContextReader,
  current: MessageWithParts[],
  chain: SessionLineage,
  intentMessages = DEFAULT_CONFIG.intentMessages,
): Promise<IntentContext & { reasons?: string[] }> {
  const pending = request({ sessionID: CURRENT });
  const config = { ...DEFAULT_CONFIG, intentMessages };
  return resolveIntent(pending, current, chain, reader, "/repo", config);
}
