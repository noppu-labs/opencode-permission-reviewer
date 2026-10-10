// Module-level helpers of the review coordinator: the logger shape and the request action hash.
import { createHash } from "node:crypto";
import type { PermissionRequest } from "../types.ts";

export type Logger = (message: string, details?: unknown) => void;

/** Stable hash of the canonical request so audit records for the same action
 *  correlate across runs. Patterns are sorted so event order does not matter.
 *  The per-invocation tool call/message IDs are deliberately excluded: two
 *  identical commands in different sessions or runs must produce the same hash. */
export function actionHash(request: PermissionRequest): string {
  const canonical = JSON.stringify({
    permission: request.permission,
    patterns: [...request.patterns].sort(),
    metadata: request.metadata,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
