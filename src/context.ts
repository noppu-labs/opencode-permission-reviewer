import {
  actorEvidenceSections,
  renderActionPurpose,
  renderAskDecisions,
  renderPolicySummary,
} from "./context/evidence-sections.ts";
import {
  elideMiddle,
  keepMostRecentBlocks,
  stableJson,
  truncate,
} from "./context/prompt-budget.ts";
import { redactSecrets } from "./redact.ts";
import type {
  MessageWithParts,
  PermissionRequest,
  PermissionToolSource,
  ReviewEnvelope,
  ReviewerConfig,
} from "./types.ts";

/** Tail-preserving truncation for recency-sensitive content: when a budget cut
 *  is unavoidable, the END (most recent content) survives, unlike `truncate`
 *  which keeps the head. */
function truncateKeepEnd(value: string, max: number): string {
  const redacted = redactSecrets(value);
  if (redacted.length <= max) return redacted;
  const omitted = redacted.length - max;
  const marker = `<truncated characters="${omitted}" />\n`;
  const available = Math.max(0, max - marker.length);
  return `${marker.slice(0, max)}${available === 0 ? "" : redacted.slice(-available)}`;
}

function partSummary(
  part: Record<string, unknown>,
  maxPartChars: number,
): string | undefined {
  const type = typeof part.type === "string" ? part.type : "unknown";
  if (type === "text" || type === "reasoning") {
    const text = typeof part.text === "string" ? part.text : "";
    if (!text.trim()) return;
    return `${type}: ${truncate(text, maxPartChars)}`;
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
  if (type === "step-start" || type === "step-finish" || type === "snapshot")
    return;
  return `${type}: ${stableJson(part, Math.min(maxPartChars, 2_000))}`;
}

function messageSummary(
  message: MessageWithParts,
  maxPartChars: number,
): string | undefined {
  const role =
    typeof message.info.role === "string" ? message.info.role : "unknown";
  const id = typeof message.info.id === "string" ? message.info.id : "unknown";
  const parts = message.parts
    .map((part) => {
      if (role === "user" && isSyntheticPart(part)) return undefined;
      return partSummary(part, maxPartChars);
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) return;
  return `MESSAGE role=${role} id=${id}\n${parts.join("\n")}`;
}

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
    const parts = message.parts.filter(
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
    const summary = messageSummary({ ...message, parts }, config.maxPartChars);
    if (!summary) continue;
    const fingerprint = summary
      .replace(/^MESSAGE[^\n]*\n/, "")
      .replace(/"callID": "[^"]*"/g, '"callID": "<identity>"');
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

function isSyntheticControlMessage(text: string): boolean {
  const normalized = text.trim();
  return (
    /^Magic Compact:\s*Compaction in progress/i.test(normalized) ||
    /^You have \d+ weighted tokens left/i.test(normalized)
  );
}

/** Host-authored text injected into a user-role message. Provenance comes from
 *  the part's own `synthetic`/`ignored` flags first; the text-pattern check is
 *  only a fallback for hosts that do not set the flags. */
function isSyntheticPart(part: Record<string, unknown>): boolean {
  if (part.type !== "text" || typeof part.text !== "string") return false;
  if (part.synthetic === true || part.ignored === true) return true;
  return isSyntheticControlMessage(part.text);
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
    const text = message.parts
      .filter((part) => part.type === "text" && !isSyntheticPart(part))
      .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
      .filter(Boolean)
      .join("\n");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    selected.push(message);
    if (selected.length >= limit) break;
  }
  return selected.reverse();
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
  const seen = new Set<string>();
  const summaries = selectIntentMessages(
    messages,
    config.intentMessages,
  ).flatMap((message) => {
    const summary = userIntentSummary(message, config);
    if (!summary) return [];
    const fingerprint = summary.replace(/^USER_INTENT[^\n]*\n/, "");
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [summary];
  });
  return keepMostRecentBlocks(
    summaries.slice(-config.intentMessages),
    config.maxIntentChars,
  );
}

/** Bound the pending command before serialization, eliding its middle rather
 *  than letting a head-only truncation cut the tail (where trailing
 *  redirections and compound command tails live). */
function boundedPendingMetadata(
  metadata: Record<string, unknown>,
  max: number,
): { metadata: Record<string, unknown>; elided: boolean } {
  const command = metadata.command;
  if (typeof command !== "string") {
    return { metadata, elided: false };
  }
  const compact = { ...metadata };
  const input = metadata.toolInput;
  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).command === command
  ) {
    const rest = { ...(input as Record<string, unknown>) };
    delete rest.command;
    compact.toolInput = rest;
  }
  return {
    metadata: { ...compact, command: elideMiddle(command, max) },
    elided: command.length > max,
  };
}

/** Render the PENDING_PERMISSION section and report whether the action under
 *  review reached the prompt IN FULL. An elided command middle or a section
 *  that itself hit the serialization budget means the reviewer judged an
 *  action it could not see completely — callers must treat that as blocking
 *  for automatic approval, whatever confidence the model reports. */
export function pendingPermissionSection(
  request: PermissionRequest,
  config: ReviewerConfig,
): { text: string; actionEvidenceComplete: boolean } {
  const { metadata, elided } = boundedPendingMetadata(
    request.metadata,
    config.maxPartChars,
  );
  const text = stableJson(
    {
      permission: request.permission,
      patterns: request.patterns.map((pattern) =>
        typeof request.metadata.command === "string" &&
        pattern === request.metadata.command
          ? "<same as metadata.command>"
          : pattern,
      ),
      metadata,
      tool: request.tool,
    },
    config.maxPartChars * 2,
  );
  const truncated = text.includes('<truncated characters="');
  return { text, actionEvidenceComplete: !elided && !truncated };
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
  // Omitted entirely when empty: absence of ask decisions carries no signal
  // for the reviewer (the transcript remains the fallback source).
  const askDecisions = renderAskDecisions(envelope.askDecisions);
  const pending = pendingPermissionSection(request, config);
  const canonicalIntent =
    envelope.intent !== undefined && envelope.lineage !== undefined;
  const evidence = [
    `PENDING_PERMISSION\n${pending.text}`,
    ...(envelope.verifiedScript === undefined
      ? []
      : [envelope.verifiedScript.text]),
    renderPolicySummary(envelope.policyTrace, config.maxPartChars * 2),
    `WORKING_DIRECTORY\n${envelope.directory}`,
    `WORKTREE\n${envelope.worktree}`,
    // Reserve the leading budget for the exact action before contextual sections.
    ...actorEvidenceSections(envelope, config),
    renderActionPurpose(
      envelope.actionPurpose,
      config.maxPartChars * 2,
      canonicalIntent,
    ),
    envelope.enrichment || "ACTION_ENRICHMENT\n<none />",
    `REPOSITORY_CONTEXT\n${stableJson(
      {
        trust: config.repositoryTrust,
        directory: envelope.directory,
        worktree: envelope.worktree,
      },
      config.maxPartChars * 2,
    )}`,
    `USER_INTENT_HISTORY\n${canonicalIntent ? "<see DIRECT_USER_INTENT />" : envelope.intentHistory || "<no user intent history available />"}`,
    ...(askDecisions === undefined
      ? []
      : [`USER_ASK_DECISIONS\n${askDecisions}`]),
    `RECENT_TRANSCRIPT\n${envelope.transcript || "<no transcript available />"}`,
  ].join("\n\n");
  const text = truncate(
    evidence,
    config.maxContextChars +
      config.maxPartChars * 2 +
      config.maxEnrichmentChars +
      config.maxIntentChars +
      (envelope.verifiedScript?.status === "full"
        ? envelope.verifiedScript.text.length
        : 0),
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
