import type { ReviewAttempt } from "../../core/review-attempt.ts";
import { responseData, withTimeout } from "../transport.ts";
import type { OpenCodeClientLike } from "../types.ts";

/** A plain object (or null-prototype) record: the shape `mcp.status` returns. */
function isPlainRecord(inventory: unknown): inventory is object {
  if (typeof inventory !== "object" || inventory === null) return false;
  if (Array.isArray(inventory)) return false;
  const prototype = Object.getPrototypeOf(inventory);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Fail closed unless the host reports no MCP servers for the isolation
 * location. The V1 client exposes `mcp.status` (a map keyed by server name,
 * `{}` when none); a missing surface, a transport error, or any reported
 * server aborts the review before a session is created. The host check, not
 * the on-disk config, is the guarantee that the reviewer location has no MCP.
 *
 * Known limitation: asking the host about a location is what boots its
 * Instance, so a bootstrap the host ignores would have its servers already
 * started by the time this throws. The guard then fails closed (no reviewer
 * session runs) but cannot unspawn them; only the on-disk config prevents
 * that, and it is verified against the host rather than assumed.
 */
export async function assertNoMcpServers(
  client: OpenCodeClientLike,
  directory: string | undefined,
  attempt: ReviewAttempt,
  timeoutMs: number,
): Promise<void> {
  if (directory === undefined)
    throw new Error("reviewer isolation unavailable");
  const mcp = client.mcp;
  if (mcp === undefined || typeof mcp.status !== "function")
    throw new Error("reviewer isolation MCP check unavailable");
  attempt.signal.throwIfAborted();
  let inventory: unknown;
  try {
    inventory = responseData(
      await attempt.wait(
        withTimeout(
          mcp.status({ query: { directory }, signal: attempt.signal }),
          timeoutMs,
        ),
      ),
      "mcp.status",
    );
  } catch (error) {
    throw new Error("reviewer isolation MCP check failed", { cause: error });
  }
  if (!isPlainRecord(inventory))
    throw new Error("reviewer isolation MCP check returned invalid data");
  if (Object.keys(inventory).length > 0)
    throw new Error("Reviewer isolation location contains MCP servers");
}
