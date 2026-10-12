// Purpose recovered from the assistant message that issued the pending tool call, and the bound every purpose text shares.

import type { MessageWithParts, PermissionRequest } from "../types.ts";

const MAX_PURPOSE_CHARS = 500;

/**
 * Locate the assistant message that issued this tool call and recover any
 * natural-language text parts that accompany it. Those parts are the agent's
 * immediate stated reason for the action — still untrusted, never authorization.
 */
export function purposeFromToolMessage(
  request: PermissionRequest,
  messages: MessageWithParts[],
): string | undefined {
  const tool = request.tool;
  if (!tool?.messageID || messages.length === 0) return undefined;

  const container = messages.find(
    (message) => message.info.id === tool.messageID,
  );
  if (!container) return undefined;
  // Only assistant prose is agent-context purpose. User text belongs in intent
  // channels and must not be relabeled here.
  if (container.info.role !== "assistant") return undefined;

  const parts = container.parts as Array<Record<string, unknown>>;
  if (!proseBelongsToCall(parts, tool.callID)) return undefined;
  return proseOf(parts);
}

/**
 * Prefer confirming the specific callID when present; if the part list has no
 * matching tool part, still allow text recovery from the same messageID —
 * some hosts omit callID linkage while keeping message identity.
 */
function proseBelongsToCall(
  parts: Array<Record<string, unknown>>,
  callID: unknown,
): boolean {
  if (typeof callID !== "string" || callID.length === 0) return true;
  if (parts.some((part) => part.type === "tool" && part.callID === callID))
    return true;
  // Message exists but does not contain this call — do not attribute its
  // prose to a different tool invocation.
  return !parts.some((part) => part.type === "tool");
}

function proseOf(parts: Array<Record<string, unknown>>): string | undefined {
  const texts: string[] = [];
  for (const part of parts) {
    const text = textPartPurpose(part);
    if (text !== undefined) texts.push(text);
  }
  if (texts.length === 0) return undefined;
  return boundPurpose(texts.join(" "));
}

function textPartPurpose(part: Record<string, unknown>): string | undefined {
  if (part.type !== "text" || typeof part.text !== "string") return undefined;
  return boundPurpose(part.text);
}

export function boundPurpose(value: string): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length < 3) return undefined;
  if (compact.length <= MAX_PURPOSE_CHARS) return compact;
  return `${compact.slice(0, MAX_PURPOSE_CHARS - 1)}…`;
}
