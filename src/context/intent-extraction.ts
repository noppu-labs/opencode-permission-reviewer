// Intent extraction: bounded parent/root message fetches and the direct, delegated and local intent blocks.

import type {
  IntentBlock,
  IntentContext,
  SessionLineage,
} from "../actor-context-types.ts";
import type { ContextReader } from "../core/ports.ts";
import { withTimeout } from "../opencode/transport.ts";
import type {
  MessageWithParts,
  PermissionRequest,
  ReviewerConfig,
} from "../types.ts";
import { prov } from "./provenance.ts";
import { METADATA_TIMEOUT_MS } from "./session-lineage.ts";

// --- parent/root message fetch for intent extraction ------------------------

async function fetchMessagesBounded(
  client: ContextReader,
  sessionID: string,
  directory: string,
  limit: number,
  intentOnly = false,
): Promise<MessageWithParts[]> {
  try {
    const response = await withTimeout(
      intentOnly && client.intentMessages
        ? client.intentMessages(sessionID, directory, limit)
        : client.messages(sessionID, directory, limit),
      METADATA_TIMEOUT_MS,
    );
    return normalizeFetched(response);
  } catch {
    return [];
  }
}

function normalizeFetched(raw: unknown): MessageWithParts[] {
  if (!Array.isArray(raw)) return [];
  return raw as MessageWithParts[];
}

// --- intent extraction ------------------------------------------------------

/** Host-authored text injected into a user-role message is never human
 *  authorization. Provenance comes from the part's own `synthetic`/`ignored`
 *  flags when the host sets them; the text-pattern check below is only a
 *  fallback for hosts that do not. */
function isSyntheticPart(part: Record<string, unknown>): boolean {
  if (part.type !== "text" || typeof part.text !== "string") return false;
  if (part.synthetic === true || part.ignored === true) return true;
  return /^\s*(Magic Compact:|You have \d+ weighted tokens left)/.test(
    part.text,
  );
}

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

/** A delegation recorded as a subtask/task tool part in a parent session.
 *  Task-tool parts carry the spawned child session id in
 *  `state.metadata.sessionId`; when present, only the delegation that created
 *  THIS session is recorded, so sibling subagent briefs are not attributed to
 *  the request under review. The task text is read from `part.prompt` /
 *  `part.description` and, for the normal tool-part shape, from the persisted
 *  call arguments in `state.input`. */
function extractDelegatedTasks(
  messages: MessageWithParts[],
  sessionID: string,
  childSessionID: string,
): IntentBlock[] {
  const blocks: IntentBlock[] = [];
  for (const message of messages) {
    for (const part of message.parts as Array<Record<string, unknown>>) {
      const isSubtask = part.type === "subtask";
      const isTaskTool = part.type === "tool" && part.tool === "task";
      if (!isSubtask && !isTaskTool) continue;
      let input: Record<string, unknown> | undefined;
      if (isTaskTool) {
        const state = part.state as Record<string, unknown> | undefined;
        const metadata = state?.metadata as Record<string, unknown> | undefined;
        if (
          typeof metadata?.sessionId === "string" &&
          metadata.sessionId !== childSessionID
        ) {
          continue;
        }
        input =
          typeof state?.input === "object" && state?.input !== null
            ? (state.input as Record<string, unknown>)
            : undefined;
      }
      const fromInput =
        typeof input?.prompt === "string"
          ? input.prompt
          : typeof input?.description === "string"
            ? input.description
            : undefined;
      const text =
        typeof part.prompt === "string"
          ? part.prompt
          : typeof part.description === "string"
            ? part.description
            : fromInput;
      if (!text?.trim()) continue;
      blocks.push({
        sessionID,
        messageID: typeof message.info.id === "string" ? message.info.id : "",
        actor: "assistant",
        text,
        synthetic: false,
        ...(typeof part.time === "object" &&
        part.time !== null &&
        "start" in part.time &&
        typeof (part.time as Record<string, unknown>).start === "number"
          ? {
              createdAt: (part.time as Record<string, unknown>).start as number,
            }
          : {}),
        provenance: prov<"intent">("intent", "parent-session", "high"),
      });
    }
  }
  return blocks;
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
  const blocks: IntentBlock[] = [];
  for (const message of messages) {
    const text = userTextOf(message);
    if (!text) continue;
    const createdAt = messageCreatedAt(message);
    blocks.push({
      sessionID,
      messageID: typeof message.info.id === "string" ? message.info.id : "",
      actor: delegated ? "assistant" : "user",
      text,
      synthetic: false,
      ...(createdAt === undefined ? {} : { createdAt }),
      provenance: prov<"intent">(
        "intent",
        delegated ? "parent-session" : "session-api",
        "high",
      ),
    });
  }
  return blocks;
}

export async function resolveIntent(
  request: PermissionRequest,
  currentMessages: MessageWithParts[],
  lineage: SessionLineage,
  client: ContextReader,
  directory: string,
  config: ReviewerConfig,
): Promise<IntentContext> {
  // One source rule for every intent section: a session created by a parent
  // agent (delegated) has NO human-authored user messages — the initial
  // briefing and every `task_id` follow-up all come from the orchestrating
  // agent. They remain visible as local-session context labeled `assistant`
  // but can never surface as human authorization.
  const currentDelegated = lineage.origin !== "human-root";
  const localSessionIntent = extractSessionUserBlocks(
    currentMessages,
    request.sessionID,
    currentDelegated,
  );
  if (lineage.origin === "unknown") {
    for (const block of localSessionIntent) {
      block.actor = "unknown";
      block.provenance = prov<"intent">("intent", "unavailable", "unknown");
    }
  }
  const directUserIntent: IntentBlock[] = currentDelegated
    ? []
    : localSessionIntent;
  const delegatedTask: IntentBlock[] = [];
  const limit = Math.max(config.intentMessages, 4);

  // Immediate parent: delegation that created/instructed this session. The
  // parent's own user messages are human intent only when the parent is
  // itself a top-level session (no grandparent).
  const parent = lineage.nodes[1];
  if (parent) {
    const [parentMessages, parentIntent] = await Promise.all([
      fetchMessagesBounded(client, parent.sessionID, directory, limit),
      fetchMessagesBounded(client, parent.sessionID, directory, limit, true),
    ]);
    delegatedTask.push(
      ...extractDelegatedTasks(
        parentMessages,
        parent.sessionID,
        request.sessionID,
      ),
    );
    directUserIntent.push(
      ...extractSessionUserBlocks(
        parentIntent,
        parent.sessionID,
        parent.parentID !== undefined,
      ).filter((block) => block.actor === "user"),
    );
  }

  // Root session (if distinct from parent AND from the current session whose
  // messages we already hold): authoritative user intent.
  const root = lineage.nodes[lineage.nodes.length - 1];
  if (root && root !== parent && root.sessionID !== request.sessionID) {
    const rootMessages = await fetchMessagesBounded(
      client,
      root.sessionID,
      directory,
      limit,
      true,
    );
    directUserIntent.push(
      ...extractSessionUserBlocks(
        rootMessages,
        root.sessionID,
        root.parentID !== undefined,
      ).filter((block) => block.actor === "user"),
    );
  }

  // Pick by creation time, not by array position: the intent arrays are
  // concatenated local → parent → root, so the last element is the root's
  // latest message even when the current session holds much newer input. When
  // no block carries a timestamp, fall back to the last recovered block.
  const timestamped = directUserIntent.filter(
    (block) => block.createdAt !== undefined,
  );
  const latestExplicitAuthorization =
    timestamped.length > 0
      ? timestamped.reduce((best, block) =>
          (block.createdAt ?? 0) > (best.createdAt ?? 0) ? block : best,
        )
      : directUserIntent[directUserIntent.length - 1];

  const reasons: string[] = [];
  if (delegatedTask.length === 0 && lineage.depth > 0)
    reasons.push("no delegation subtask located in parent session");
  if (lineage.missingParents.length > 0)
    reasons.push(`missing parents: ${lineage.missingParents.join(", ")}`);
  if (directUserIntent.length === 0)
    reasons.push(
      currentDelegated
        ? "delegated session: no human-authored user messages exist in this session chain window"
        : "no direct user intent recovered",
    );

  const completeness: IntentContext["completeness"] =
    directUserIntent.length > 0 &&
    (delegatedTask.length > 0 || !currentDelegated)
      ? "complete"
      : directUserIntent.length > 0 || localSessionIntent.length > 0
        ? "partial"
        : "insufficient";

  return {
    directUserIntent,
    delegatedTask,
    localSessionIntent,
    conflictingInstructions: [],
    ...(latestExplicitAuthorization === undefined
      ? {}
      : { latestExplicitAuthorization }),
    completeness,
    ...(reasons.length === 0 ? {} : { reasons }),
  };
}
