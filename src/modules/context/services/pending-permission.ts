// The PENDING_PERMISSION section: the pending command bounded by middle elision, and whether the action reached the prompt in full.

import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { elideMiddle, stableJson } from "./prompt-budget.ts";

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
