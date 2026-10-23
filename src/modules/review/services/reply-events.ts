// Host `permission.replied` events: which request one names, and whether it
// supersedes that request's in-flight review.
import type { CoordinatorState } from "./coordinator-state.ts";

/** The request ID a `permission.replied` event names, or undefined for any
 *  other event or one without a string session and request ID. */
function repliedRequestID(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const record = event as Record<string, unknown>;
  if (record.type !== "permission.replied") return undefined;
  const properties =
    typeof record.properties === "object" && record.properties !== null
      ? (record.properties as Record<string, unknown>)
      : undefined;
  if (!properties || typeof properties.sessionID !== "string") return undefined;
  return typeof properties.requestID === "string"
    ? properties.requestID
    : undefined;
}

/** A reply event for a pending request supersedes its review, unless the
 *  review's own reply is in transport or was accepted. */
export function supersedeOnReply(
  state: Pick<CoordinatorState, "attempts" | "resolvedManually">,
  pending: Map<string, Promise<unknown>>,
  event: unknown,
): void {
  // While our reply is in transport, its event can precede its acknowledgement.
  // Only the transport can distinguish our accepted reply from a competing
  // human reply. Before that phase, a terminal event supersedes the review.
  const requestID = repliedRequestID(event);
  if (requestID === undefined || !pending.has(requestID)) return;
  const attempt = state.attempts.get(requestID);
  if (
    attempt?.application === "unknown" ||
    attempt?.application === "reply-accepted"
  )
    return;
  state.resolvedManually.add(requestID);
  attempt?.close("cancelled");
}
