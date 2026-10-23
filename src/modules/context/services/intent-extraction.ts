// Intent extraction: bounded parent/root message fetches and the direct, delegated and local intent blocks.

import type {
  IntentBlock,
  IntentContext,
  SessionLineage,
} from "../../../kernel/actor-context-types.ts";
import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { withTimeout } from "../../../utils/with-timeout.ts";
import type { MessageWithParts } from "../models/message.ts";
import type { ContextReader } from "../ports.ts";
import { extractDelegatedTasks } from "./delegated-tasks.ts";
import {
  intentCompleteness,
  intentReasons,
  latestAuthorization,
} from "./intent-assessment.ts";
import {
  humanIntentBlocks,
  localIntentBlocks,
} from "./session-intent-blocks.ts";
import { METADATA_TIMEOUT_MS } from "./session-lineage.ts";

// --- parent/root message fetch for intent extraction ------------------------

async function fetchMessagesBounded(
  reader: ContextReader,
  sessionID: string,
  directory: string,
  limit: number,
  intentOnly = false,
): Promise<MessageWithParts[]> {
  try {
    const response = await withTimeout(
      intentOnly && reader.intentMessages
        ? reader.intentMessages(sessionID, directory, limit)
        : reader.messages(sessionID, directory, limit),
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

export async function resolveIntent(
  request: PermissionRequest,
  currentMessages: MessageWithParts[],
  lineage: SessionLineage,
  reader: ContextReader,
  directory: string,
  config: ReviewerConfig,
): Promise<IntentContext> {
  // One source rule for every intent section: a session created by a parent
  // agent (delegated) has NO human-authored user messages — the initial
  // briefing and every `task_id` follow-up all come from the orchestrating
  // agent. They remain visible as local-session context labeled `assistant`
  // but can never surface as human authorization.
  const currentDelegated = lineage.origin !== "human-root";
  const localSessionIntent = localIntentBlocks(
    request,
    currentMessages,
    lineage,
    currentDelegated,
  );
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
      fetchMessagesBounded(reader, parent.sessionID, directory, limit),
      fetchMessagesBounded(reader, parent.sessionID, directory, limit, true),
    ]);
    delegatedTask.push(
      ...extractDelegatedTasks(
        parentMessages,
        parent.sessionID,
        request.sessionID,
      ),
    );
    directUserIntent.push(...humanIntentBlocks(parentIntent, parent));
  }

  // Root session (if distinct from parent AND from the current session whose
  // messages we already hold): authoritative user intent.
  const root = lineage.nodes[lineage.nodes.length - 1];
  if (root && root !== parent && root.sessionID !== request.sessionID) {
    const rootMessages = await fetchMessagesBounded(
      reader,
      root.sessionID,
      directory,
      limit,
      true,
    );
    directUserIntent.push(...humanIntentBlocks(rootMessages, root));
  }

  const latestExplicitAuthorization = latestAuthorization(directUserIntent);
  const reasons = intentReasons(
    lineage,
    delegatedTask,
    directUserIntent,
    currentDelegated,
  );
  const completeness = intentCompleteness(
    directUserIntent,
    delegatedTask,
    localSessionIntent,
    currentDelegated,
  );

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
