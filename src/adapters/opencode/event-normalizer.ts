import type { PermissionRequest } from "../../kernel/permission-request.ts";
import { asObjectLike } from "../../utils/is-record.ts";

type UnknownRecord = Record<string, unknown>;

function strings(items: unknown[]): string[] {
  return items.filter((item): item is string => typeof item === "string");
}

/** The `properties` record of a `permission.asked` event, if it has one. */
function askedProperties(event: unknown): UnknownRecord | undefined {
  const record = asObjectLike(event);
  if (record?.type !== "permission.asked") return;
  return asObjectLike(record.properties);
}

function toolReference(value: unknown): PermissionRequest["tool"] {
  const tool = asObjectLike(value);
  if (typeof tool?.messageID !== "string" || typeof tool.callID !== "string")
    return undefined;
  return { messageID: tool.messageID, callID: tool.callID };
}

/**
 * Normalize a raw OpenCode event into a {@link PermissionRequest}.
 *
 * Returns `undefined` for anything that is not a well-formed
 * `permission.asked` event, so callers can ignore irrelevant events without
 * inspecting their shape.
 */
export function extractPermissionRequest(
  event: unknown,
): PermissionRequest | undefined {
  const request = askedProperties(event);
  if (!request) return;
  if (typeof request.id !== "string" || typeof request.sessionID !== "string")
    return;
  if (
    typeof request.permission !== "string" ||
    !Array.isArray(request.patterns)
  )
    return;

  const patterns = strings(request.patterns);
  if (patterns.length !== request.patterns.length) return;
  const metadata = asObjectLike(request.metadata) ?? {};
  const always = Array.isArray(request.always) ? strings(request.always) : [];
  // `always` is parsed for forward compatibility (a future "persist this
  // approval" surface) but is not consumed by the reviewer yet.
  void always;
  const tool = toolReference(request.tool);

  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.permission,
    patterns,
    metadata,
    always,
    ...(tool === undefined ? {} : { tool }),
  };
}
