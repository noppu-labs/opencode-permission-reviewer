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

export type HeldCalls<R> = {
  resolvers: R[];
  held: (count: number) => Promise<void>;
};

/**
 * `held(count)` fails after 2 s, inside bun's 5 s test timeout, so a call that never arrives
 * fails with a message instead of a bare timeout.
 */
export function holdCalls<R>(
  what: string,
): HeldCalls<R> & { hold: (resolve: R) => void } {
  const resolvers: R[] = [];
  const waiters = new Set<() => void>();
  const hold = (resolve: R): void => {
    resolvers.push(resolve);
    for (const wake of waiters) wake();
  };
  const held = (count: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(wake);
        reject(
          new Error(
            `only ${resolvers.length} of ${count} ${what} reached the held call`,
          ),
        );
      }, 2000);
      const wake = (): void => {
        if (resolvers.length < count) return;
        waiters.delete(wake);
        clearTimeout(timer);
        resolve();
      };
      waiters.add(wake);
      wake();
    });
  return { resolvers, held, hold };
}
