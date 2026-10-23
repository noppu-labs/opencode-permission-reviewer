// USER_INTENT_HISTORY blocks: the literal user text of a message, its USER_INTENT block, and the deduplicated summaries.

import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { MessageWithParts } from "../models/message.ts";
import { truncate } from "./prompt-budget.ts";
import { isSyntheticPart } from "./synthetic-parts.ts";

/** The trimmed, non-synthetic text parts of a message, one per line. */
export function literalUserText(message: MessageWithParts): string {
  return message.parts
    .filter((part) => part.type === "text" && !isSyntheticPart(part))
    .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function userIntentSummary(
  message: MessageWithParts,
  config: ReviewerConfig,
): string | undefined {
  if (message.info.role !== "user") return;
  const texts = message.parts.flatMap((part) => {
    if (part.type !== "text" || typeof part.text !== "string") return [];
    if (isSyntheticPart(part)) return [];
    const text = part.text.trim();
    if (!text) return [];
    return [truncate(text, config.maxPartChars)];
  });
  if (texts.length === 0) return;
  const id = typeof message.info.id === "string" ? message.info.id : "unknown";
  const time =
    typeof message.info.time === "object" &&
    message.info.time !== null &&
    typeof (message.info.time as Record<string, unknown>).created === "number"
      ? ` created=${(message.info.time as Record<string, unknown>).created}`
      : "";
  return `USER_INTENT id=${id}${time}\n${texts.join("\n")}`;
}

/** One USER_INTENT block per message, dropping a block whose text repeats an earlier one. */
export function distinctIntentSummaries(
  messages: MessageWithParts[],
  config: ReviewerConfig,
): string[] {
  const seen = new Set<string>();
  return messages.flatMap((message) => {
    const summary = userIntentSummary(message, config);
    if (!summary) return [];
    const fingerprint = summary.replace(/^USER_INTENT[^\n]*\n/, "");
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [summary];
  });
}
