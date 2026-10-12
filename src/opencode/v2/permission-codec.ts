import type { PermissionEvaluation } from "@opencode/plugin/promise/permission";
import type { NormalizedReviewRequest } from "../../core/contracts.ts";

type PermissionInput = Pick<
  PermissionEvaluation,
  "action" | "resources" | "metadata" | "source" | "effect"
> & { sessionID: string; agent?: string };

/** Host action names the reviewer's permission vocabulary spells differently. */
const REVIEW_PERMISSIONS = new Map([
  ["shell", "bash"],
  ["subagent", "task"],
]);

function exactActionInput(
  actionInput: unknown,
): Record<string, unknown> | undefined {
  return typeof actionInput === "object" &&
    actionInput !== null &&
    !Array.isArray(actionInput)
    ? (structuredClone(actionInput) as Record<string, unknown>)
    : undefined;
}

/** The request metadata and the cloned exact action input it carries. */
function reviewMetadata(
  input: PermissionInput,
  permission: string,
  actionInput: unknown,
): {
  metadata: NormalizedReviewRequest["request"]["metadata"];
  exactInput: Record<string, unknown> | undefined;
} {
  const metadata = structuredClone(input.metadata ?? {});
  // Preserve the host hint as evidence, never as a trusted profile override.
  delete metadata.hostAgent;
  if (input.agent !== undefined) metadata.hostAgent = input.agent;
  const exactInput = exactActionInput(actionInput);
  if (exactInput) {
    metadata.toolInput = exactInput;
    if (permission === "bash" && typeof exactInput.command === "string")
      metadata.command = exactInput.command;
  }
  return { metadata, exactInput };
}

// A permission resource is a matching constraint, never the command itself.
function actionEvidenceComplete(
  permission: string,
  metadata: Record<string, unknown>,
  exactInput: Record<string, unknown> | undefined,
): boolean {
  if (permission !== "bash") return exactInput !== undefined;
  return (
    typeof metadata.command === "string" && metadata.command.trim().length > 0
  );
}

function toolReference(
  source: PermissionInput["source"],
): { tool: { messageID: string; callID: string } } | Record<string, never> {
  return source === undefined
    ? {}
    : { tool: { messageID: source.messageID, callID: source.id } };
}

export function normalizeV2Permission(
  input: PermissionInput,
  scope: {
    reviewID: string;
    generation: string;
    directory: string;
    hostVersion: string;
  },
  actionInput?: unknown,
): NormalizedReviewRequest {
  const permission = REVIEW_PERMISSIONS.get(input.action) ?? input.action;
  const { metadata, exactInput } = reviewMetadata(
    input,
    permission,
    actionInput,
  );
  return {
    ...scope,
    host: "v2",
    nativeAction: input.action,
    actionEvidenceComplete: actionEvidenceComplete(
      permission,
      metadata,
      exactInput,
    ),
    request: {
      id: scope.reviewID,
      sessionID: input.sessionID,
      permission,
      patterns: [...input.resources],
      metadata,
      always: [],
      ...toolReference(input.source),
    },
  };
}
