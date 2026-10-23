// Session intent blocks: the user-role text of one session as intent blocks, labeled by whether the session was delegated.

import type { MessageWithParts, PermissionRequest } from "../../../types.ts";
import type {
  IntentBlock,
  SessionLineage,
  SessionNode,
} from "../models/actor-context-types.ts";
import { prov } from "./provenance.ts";
import { isSyntheticPart } from "./synthetic-parts.ts";

function messageCreatedAt(message: MessageWithParts): number | undefined {
  const time = message.info.time as Record<string, unknown> | undefined;
  return typeof time === "object" &&
    time !== null &&
    typeof time.created === "number"
    ? time.created
    : undefined;
}

function userTextOf(message: MessageWithParts): string | undefined {
  if (message.info.role !== "user") return undefined;
  for (const part of message.parts as Array<Record<string, unknown>>) {
    if (isSyntheticPart(part)) continue;
    if (typeof part.text === "string" && part.text.trim()) {
      return part.text;
    }
  }
  return undefined;
}

/** Extract the user-role text blocks of one session with a single source rule:
 *  in a DELEGATED session (one created by a parent agent's task tool) every
 *  user-role message is agent-authored — the initial briefing AND any later
 *  `task_id` follow-ups — so they are labeled `assistant` and can never be
 *  presented as human authorization. In a top-level session they are human
 *  input. Message-window position is irrelevant to origin, which is why this
 *  does not "skip the first message". */
function extractSessionUserBlocks(
  messages: MessageWithParts[],
  sessionID: string,
  delegated: boolean,
): IntentBlock[] {
  const actor = delegated ? "assistant" : "user";
  const source = delegated ? "parent-session" : "session-api";
  const blocks: IntentBlock[] = [];
  for (const message of messages) {
    const text = userTextOf(message);
    if (!text) continue;
    const createdAt = messageCreatedAt(message);
    blocks.push({
      sessionID,
      messageID: typeof message.info.id === "string" ? message.info.id : "",
      actor,
      text,
      synthetic: false,
      ...(createdAt === undefined ? {} : { createdAt }),
      provenance: prov<"intent">("intent", source, "high"),
    });
  }
  return blocks;
}

/** The blocks of a parent or root session that count as human intent: only
 *  those of a top-level session (one with no parent of its own). */
export function humanIntentBlocks(
  messages: MessageWithParts[],
  node: SessionNode,
): IntentBlock[] {
  return extractSessionUserBlocks(
    messages,
    node.sessionID,
    node.parentID !== undefined,
  ).filter((block) => block.actor === "user");
}

/** The current session's own blocks; with an unknown origin they are
 *  relabeled as unknown and unavailable. */
export function localIntentBlocks(
  request: PermissionRequest,
  currentMessages: MessageWithParts[],
  lineage: SessionLineage,
  currentDelegated: boolean,
): IntentBlock[] {
  const blocks = extractSessionUserBlocks(
    currentMessages,
    request.sessionID,
    currentDelegated,
  );
  if (lineage.origin === "unknown") {
    for (const block of blocks) {
      block.actor = "unknown";
      block.provenance = prov<"intent">("intent", "unavailable", "unknown");
    }
  }
  return blocks;
}
