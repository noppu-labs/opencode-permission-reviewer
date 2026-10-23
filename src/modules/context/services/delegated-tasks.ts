// Delegated tasks: the subtask and task-tool parts of a parent session that created this session, as intent blocks.

import type { MessageWithParts } from "../../../types.ts";
import type { IntentBlock } from "../models/actor-context-types.ts";
import { prov } from "./provenance.ts";

function promptOrDescription(
  record: Record<string, unknown> | undefined,
): string | undefined {
  return typeof record?.prompt === "string"
    ? record.prompt
    : typeof record?.description === "string"
      ? record.description
      : undefined;
}

/** Whether a task-tool state records that it spawned a different child session. */
function spawnedOtherChild(
  state: Record<string, unknown> | undefined,
  childSessionID: string,
): boolean {
  const metadata = state?.metadata as Record<string, unknown> | undefined;
  return (
    typeof metadata?.sessionId === "string" &&
    metadata.sessionId !== childSessionID
  );
}

function callInput(
  state: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return typeof state?.input === "object" && state?.input !== null
    ? (state.input as Record<string, unknown>)
    : undefined;
}

/** The task text of a subtask part, or of a task-tool part delegating to this
 *  child: read from the part first and then from the task-tool call arguments. */
function delegatedTaskText(
  part: Record<string, unknown>,
  childSessionID: string,
): string | undefined {
  const isSubtask = part.type === "subtask";
  const isTaskTool = part.type === "tool" && part.tool === "task";
  if (!isSubtask && !isTaskTool) return undefined;
  const state = isTaskTool
    ? (part.state as Record<string, unknown> | undefined)
    : undefined;
  if (spawnedOtherChild(state, childSessionID)) return undefined;
  const fromInput = promptOrDescription(callInput(state));
  return promptOrDescription(part) ?? fromInput;
}

function taskStartedAt(part: Record<string, unknown>): number | undefined {
  return typeof part.time === "object" &&
    part.time !== null &&
    "start" in part.time &&
    typeof (part.time as Record<string, unknown>).start === "number"
    ? ((part.time as Record<string, unknown>).start as number)
    : undefined;
}

function delegatedTaskBlock(
  sessionID: string,
  message: MessageWithParts,
  part: Record<string, unknown>,
  text: string,
): IntentBlock {
  const createdAt = taskStartedAt(part);
  return {
    sessionID,
    messageID: typeof message.info.id === "string" ? message.info.id : "",
    actor: "assistant",
    text,
    synthetic: false,
    ...(createdAt === undefined ? {} : { createdAt }),
    provenance: prov<"intent">("intent", "parent-session", "high"),
  };
}

/** A delegation recorded as a subtask/task tool part in a parent session.
 *  Task-tool parts carry the spawned child session id in
 *  `state.metadata.sessionId`; when present, only the delegation that created
 *  THIS session is recorded, so sibling subagent briefs are not attributed to
 *  the request under review. The task text is read from `part.prompt` /
 *  `part.description` and, for the normal tool-part shape, from the persisted
 *  call arguments in `state.input`. */
export function extractDelegatedTasks(
  messages: MessageWithParts[],
  sessionID: string,
  childSessionID: string,
): IntentBlock[] {
  const blocks: IntentBlock[] = [];
  for (const message of messages) {
    for (const part of message.parts as Array<Record<string, unknown>>) {
      const text = delegatedTaskText(part, childSessionID);
      if (!text?.trim()) continue;
      blocks.push(delegatedTaskBlock(sessionID, message, part, text));
    }
  }
  return blocks;
}
