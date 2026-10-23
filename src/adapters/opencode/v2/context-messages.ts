import type { SessionInfo } from "@opencode/client";
import type { MessageWithParts } from "../../../types.ts";
import type { V2HostApi } from "./host-api.ts";

type ContextMessage = Awaited<
  ReturnType<V2HostApi["session"]["context"]>
>[number];
type UserMessage = Extract<ContextMessage, { type: "user" }>;
type AssistantMessage = Extract<ContextMessage, { type: "assistant" }>;
type AssistantPart = AssistantMessage["content"][number];

function omittedHistoryNotice(): MessageWithParts {
  return {
    info: { role: "system" },
    parts: [
      {
        type: "text",
        synthetic: true,
        text: "Earlier session context was compacted or omitted. Summaries are not literal user authorization.",
      },
    ],
  };
}

/** A user message, demoted to synthetic assistant text when a fork inherited it. */
export function userMessage(
  session: SessionInfo,
  message: Pick<UserMessage, "id" | "text" | "time">,
): MessageWithParts {
  const fork = session.fork;
  const inherited =
    fork !== undefined && message.time.created < session.time.created;
  return {
    info: {
      id: message.id,
      role: inherited ? "assistant" : "user",
      time: message.time,
      ...(inherited
        ? { originSessionID: fork.sessionID, synthetic: true }
        : {}),
    },
    parts: [
      {
        type: "text",
        text: message.text,
        ...(inherited ? { synthetic: true } : {}),
      },
    ],
  };
}

function assistantPart(part: AssistantPart): Record<string, unknown> {
  if (part.type === "tool") {
    return {
      type: "tool",
      callID: part.id,
      tool: part.name,
      state: part.state,
    };
  }
  return { ...part };
}

function assistantMessage(message: AssistantMessage): MessageWithParts {
  return {
    info: {
      id: message.id,
      role: "assistant",
      agent: message.agent,
      time: message.time,
    },
    parts: message.content.map(assistantPart),
  };
}

export function contextMessages(
  session: SessionInfo,
  messages: ContextMessage[],
  limit: number,
): MessageWithParts[] {
  const result: MessageWithParts[] = [];
  if (
    messages.length > limit ||
    messages.some((message) => message.type === "compaction")
  )
    result.push(omittedHistoryNotice());
  for (const message of messages.slice(-limit)) {
    if (message.type === "user") result.push(userMessage(session, message));
    else if (message.type === "assistant")
      result.push(assistantMessage(message));
  }
  return result;
}
