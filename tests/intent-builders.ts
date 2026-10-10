// Message, part and intent-block builders shared by the resolveIntent characterisation tests.

import type { IntentBlock } from "../src/actor-context-types.ts";
import type { MessageWithParts } from "../src/types.ts";

export type Part = Record<string, unknown>;

export function user(
  id: string,
  parts: Part[],
  created?: number,
): MessageWithParts {
  const time = created === undefined ? {} : { time: { created } };
  return { info: { id, role: "user", ...time }, parts };
}

export const text = (value: string, extra: Part = {}): Part => ({
  type: "text",
  text: value,
  ...extra,
});

export function block(
  sessionID: string,
  messageID: string,
  actor: IntentBlock["actor"],
  value: string,
  source: "session-api" | "parent-session",
  createdAt?: number,
): IntentBlock {
  return {
    sessionID,
    messageID,
    actor,
    text: value,
    synthetic: false,
    ...(createdAt === undefined ? {} : { createdAt }),
    provenance: { value: "intent", source, confidence: "high" },
  };
}
