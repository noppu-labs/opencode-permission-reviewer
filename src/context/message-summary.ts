// Transcript blocks: the per-message MESSAGE block, its part filter and its dedupe fingerprint.

import type { MessageWithParts, PermissionToolSource } from "../types.ts";
import { stableJson, truncate } from "./prompt-budget.ts";
import { isSyntheticPromptPart } from "./synthetic-parts.ts";

/** Part kinds that carry no reviewable content. */
const SILENT_PART_TYPES = new Set(["step-start", "step-finish", "snapshot"]);

function textPartSummary(
  type: string,
  part: Record<string, unknown>,
  maxPartChars: number,
): string | undefined {
  const text = typeof part.text === "string" ? part.text : "";
  if (!text.trim()) return;
  return `${type}: ${truncate(text, maxPartChars)}`;
}

function partSummary(
  part: Record<string, unknown>,
  maxPartChars: number,
): string | undefined {
  const type = typeof part.type === "string" ? part.type : "unknown";
  if (type === "text" || type === "reasoning") {
    return textPartSummary(type, part, maxPartChars);
  }
  if (type === "tool") {
    const compact = {
      type,
      tool: part.tool,
      callID: part.callID,
      state: part.state,
    };
    return `tool: ${stableJson(compact, maxPartChars)}`;
  }
  if (type === "file") {
    return `file: ${stableJson({ mime: part.mime, filename: part.filename, url: part.url }, 1_000)}`;
  }
  if (SILENT_PART_TYPES.has(type)) return;
  return `${type}: ${stableJson(part, Math.min(maxPartChars, 2_000))}`;
}

export function messageSummary(
  message: MessageWithParts,
  maxPartChars: number,
): string | undefined {
  const role =
    typeof message.info.role === "string" ? message.info.role : "unknown";
  const id = typeof message.info.id === "string" ? message.info.id : "unknown";
  const parts = message.parts
    .map((part) => {
      if (role === "user" && isSyntheticPromptPart(part)) return undefined;
      return partSummary(part, maxPartChars);
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) return;
  return `MESSAGE role=${role} id=${id}\n${parts.join("\n")}`;
}

/** The parts of one message that reach the transcript: no reasoning, no user
 *  text when user messages are omitted, and not the pending tool call itself. */
export function transcriptParts(
  message: MessageWithParts,
  options?: { omitUserMessages?: boolean; pendingTool?: PermissionToolSource },
): Array<Record<string, unknown>> {
  return message.parts.filter(
    (part) =>
      part.type !== "reasoning" &&
      !(
        options?.omitUserMessages &&
        message.info.role === "user" &&
        part.type === "text"
      ) &&
      !(
        part.type === "tool" &&
        part.callID === options?.pendingTool?.callID &&
        message.info.id === options?.pendingTool?.messageID
      ),
  );
}

/** A MESSAGE block without its header line and with call ids masked, so
 *  repeated operational output deduplicates. */
export function transcriptFingerprint(summary: string): string {
  return summary
    .replace(/^MESSAGE[^\n]*\n/, "")
    .replace(/"callID": "[^"]*"/g, '"callID": "<identity>"');
}
