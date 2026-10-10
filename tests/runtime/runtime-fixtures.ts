import type { ReviewUiStatus } from "../../src/ui-protocol.ts";
import type { MockClient, runtime } from "../helpers.ts";

export function replyBody(value: unknown): Record<string, unknown> {
  return ((value as Record<string, unknown>).body ?? {}) as Record<
    string,
    unknown
  >;
}

export function manualReply(
  harness: ReturnType<typeof runtime>,
  requestID: string,
  reply: "once" | "reject",
): void {
  harness.runtime.handlePermissionReply({
    type: "permission.replied",
    properties: { sessionID: "ses_main", requestID, reply },
  });
}

export function phases(client: MockClient): ReviewUiStatus["phase"][] {
  return client.uiStatuses.map((status) => status.phase);
}
