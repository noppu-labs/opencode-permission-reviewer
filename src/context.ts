import { evidenceBudget, evidenceSections } from "./context/evidence-layout.ts";
import { renderAskDecisions } from "./context/evidence-sections.ts";
import {
  distinctIntentSummaries,
  literalUserText,
} from "./context/intent-history.ts";
import {
  messageSummary,
  transcriptFingerprint,
  transcriptParts,
} from "./context/message-summary.ts";
import { pendingPermissionSection } from "./context/pending-permission.ts";
import {
  keepMostRecentBlocks,
  truncate,
  truncateKeepEnd,
} from "./context/prompt-budget.ts";
import type {
  MessageWithParts,
  PermissionRequest,
  PermissionToolSource,
  ReviewEnvelope,
  ReviewerConfig,
} from "./types.ts";

export function buildTranscript(
  messages: MessageWithParts[],
  config: ReviewerConfig,
  options?: { omitUserMessages?: boolean; pendingTool?: PermissionToolSource },
): string {
  const selected = messages.slice(-config.transcriptMessages);
  // Budget from the newest message backwards so the recency-sensitive tail of
  // the conversation always survives a cut; the oldest messages of the window
  // are dropped first.
  const kept: string[] = [];
  const seen = new Set<string>();
  let remaining = config.maxContextChars;
  for (const message of [...selected].reverse()) {
    const parts = transcriptParts(message, options);
    const summary = messageSummary({ ...message, parts }, config.maxPartChars);
    if (!summary) continue;
    const fingerprint = transcriptFingerprint(summary);
    if (message.info.role !== "user" && seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const separator = kept.length === 0 ? 0 : 2;
    if (remaining <= separator) break;
    const bounded = truncateKeepEnd(summary, remaining - separator);
    kept.push(bounded);
    remaining -= bounded.length + separator;
  }
  return kept.reverse().join("\n\n");
}

/** Keep the newest occurrence of literal user text, preserving chronological order. */
export function selectIntentMessages(
  messages: MessageWithParts[],
  limit: number,
): MessageWithParts[] {
  const seen = new Set<string>();
  const selected: MessageWithParts[] = [];
  for (const message of [...messages].reverse()) {
    if (message.info.role !== "user" || message.info.synthetic === true)
      continue;
    const text = literalUserText(message);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    selected.push(message);
    if (selected.length >= limit) break;
  }
  return selected.reverse();
}

/** Render the USER_INTENT_HISTORY section. In a delegated session there is no
 *  human-authored user text at all (every user-role message is the parent
 *  agent's briefing or a `task_id` follow-up), so the section is emptied
 *  rather than risking agent instructions being read as human intent — they
 *  already appear, correctly labeled, in LOCAL_SESSION_CONTEXT. */
export function buildIntentHistory(
  messages: MessageWithParts[],
  config: ReviewerConfig,
  options?: { delegatedSession?: boolean },
): string {
  if (options?.delegatedSession === true) return "";
  const summaries = distinctIntentSummaries(
    selectIntentMessages(messages, config.intentMessages),
    config,
  );
  return keepMostRecentBlocks(
    summaries.slice(-config.intentMessages),
    config.maxIntentChars,
  );
}

export function buildEvidence(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
): string {
  return buildEvidenceResult(envelope, config).text;
}

export function buildEvidenceResult(
  envelope: ReviewEnvelope,
  config: ReviewerConfig,
): { text: string; actionEvidenceComplete: boolean } {
  const request: PermissionRequest = envelope.request;
  const askDecisions = renderAskDecisions(envelope.askDecisions);
  const pending = pendingPermissionSection(request, config);
  const text = truncate(
    evidenceSections(envelope, config, pending.text, askDecisions).join("\n\n"),
    evidenceBudget(envelope, config),
  );
  return {
    text,
    actionEvidenceComplete:
      envelope.actionEvidenceComplete !== false &&
      pending.actionEvidenceComplete &&
      text.startsWith(`PENDING_PERMISSION\n${pending.text}\n\n`) &&
      (envelope.verifiedScript === undefined ||
        text.includes(envelope.verifiedScript.text)),
  };
}

export function normalizeMessages(value: unknown): MessageWithParts[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const info =
      typeof record.info === "object" && record.info !== null
        ? record.info
        : {};
    const parts = Array.isArray(record.parts)
      ? record.parts.filter(
          (part): part is Record<string, unknown> =>
            typeof part === "object" && part !== null,
        )
      : [];
    return [{ info: info as MessageWithParts["info"], parts }];
  });
}
