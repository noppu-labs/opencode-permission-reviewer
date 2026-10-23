import type { MessageWithParts, PermissionRequest } from "../../../types.ts";
import type {
  ActionPurpose,
  EvidenceConfidence,
  IntentBlock,
  IntentContext,
} from "../models/actor-context-types.ts";
import {
  boundPurpose,
  purposeFromToolMessage,
} from "./tool-message-purpose.ts";

const PURPOSE_METADATA_KEYS = [
  "purpose",
  "description",
  "goal",
  "intent",
] as const;

/**
 * Resolve the operational purpose of a pending action.
 *
 * Order (never invent):
 * 1. Explicit purpose fields on the permission/tool metadata (`agent-context`).
 * 2. Text from the exact assistant message that contains this tool call
 *    (`agent-context`), located via `request.tool.messageID` / `callID`.
 * 3. Local session intent, then a single unambiguous delegated task
 *    (`intent-derived`). Multiple parent delegated tasks are ignored — they
 *    may belong to sibling subagents and must not be attributed here.
 * 4. `unavailable` when no usable evidence exists.
 *
 * Purpose explains what the agent appears to be trying to do. It is untrusted
 * evidence and never demonstrates user authorization by itself.
 */
export function resolveActionPurpose(
  request: PermissionRequest,
  intent: IntentContext | undefined,
  messages: MessageWithParts[] = [],
): ActionPurpose {
  const fromMetadata = purposeFromMetadata(request.metadata);
  if (fromMetadata !== undefined) {
    return {
      text: fromMetadata,
      source: "agent-context",
      confidence: "medium",
    };
  }

  const fromToolMessage = purposeFromToolMessage(request, messages);
  if (fromToolMessage !== undefined) {
    return {
      text: fromToolMessage,
      source: "agent-context",
      confidence: "medium",
    };
  }

  const fromIntent = purposeFromIntent(intent);
  if (fromIntent !== undefined) {
    return {
      text: fromIntent.text,
      source: "intent-derived",
      confidence: fromIntent.confidence,
    };
  }

  return { source: "unavailable", confidence: "unknown" };
}

function purposeFromMetadata(
  metadata: Record<string, unknown>,
): string | undefined {
  for (const key of PURPOSE_METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value === "string") {
      const text = boundPurpose(value);
      if (text !== undefined) return text;
    }
  }
  return undefined;
}

function purposeFromIntent(
  intent: IntentContext | undefined,
): { text: string; confidence: EvidenceConfidence } | undefined {
  if (intent === undefined) return undefined;

  // Prefer intent recovered in the current session — it cannot be a sibling's
  // delegated brief from the parent transcript.
  const local = latestBlockText(intent.localSessionIntent);
  if (local !== undefined) {
    return { text: local, confidence: "medium" };
  }

  // Parent delegated tasks are only safe when exactly one is present. With
  // multiple siblings the parent transcript lists several briefs and the
  // latest one may belong to a different child session.
  const [onlyTask] = intent.delegatedTask;
  if (intent.delegatedTask.length === 1 && onlyTask !== undefined) {
    const text = boundPurpose(onlyTask.text);
    if (text !== undefined) {
      return { text, confidence: "medium" };
    }
  }

  return undefined;
}

function latestBlockText(blocks: IntentBlock[]): string | undefined {
  for (const block of [...blocks].reverse()) {
    const text = boundPurpose(block.text);
    if (text !== undefined) return text;
  }
  return undefined;
}
