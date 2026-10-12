import type { Plugin } from "@opencode/plugin/tui";
import type { ReviewUiState } from "../ui-state.ts";
import { object } from "./host-value.ts";
import { type Connection, receive, release } from "./review-connection.ts";
import { isSnapshot, ReviewStore } from "./review-store.ts";
import { ReviewerRpc } from "./rpc.ts";

type Context = Parameters<Plugin.Definition["setup"]>[0];

/** The reviewer's status for one directory, kept in sync over the read-only
 *  reviewer RPC: a snapshot, then revisioned update events. */
interface ReviewFeed {
  readonly directory: string | undefined;
  readonly state: ReviewUiState;
  connect(): Promise<void>;
  /** Switches to another directory with an empty state, and reconnects. */
  retarget(directory: string | undefined): void;
  /** Expires overdue reviews (dropping the connection) and dismisses old results. */
  sweep(): void;
  stop(): void;
}

export function createReviewFeed(
  ctx: Context,
  changed: () => void,
): ReviewFeed {
  let directory = ctx.location?.directory;
  const rpc = ctx.client.rpc(ReviewerRpc);
  const store = new ReviewStore((status) =>
    ctx.ui.toast.show({
      variant: "warning",
      title: "Manual review required",
      message: status.reason ?? "The host requires your decision.",
    }),
  );
  let stopped = false;
  let controller: AbortController | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  const owns = (current: AbortController): boolean =>
    controller === current && !stopped;
  const update = (value: unknown, owner: AbortController): void => {
    if (owner !== controller || owner.signal.aborted) return;
    const outcome = store.accept(value, directory);
    if (outcome === "foreign") owner.abort();
    if (outcome === "applied") changed();
  };
  // Unknown means the UI lacks authoritative state, never human approval.
  const disconnect = (current: AbortController): void => {
    if (!owns(current)) return;
    store.markDisconnected();
    changed();
  };
  const listen = async (connection: Connection): Promise<void> => {
    for await (const event of rpc.events.subscribe("review.updated", {
      signal: connection.controller.signal,
    }))
      receive(event, connection, update);
  };
  // Applies the snapshot; false when the connection was dropped meanwhile.
  const applySnapshot = (value: unknown, connection: Connection): boolean => {
    const snapshot = object(value);
    if (!isSnapshot(snapshot, connection.directory))
      throw new Error("Invalid reviewer snapshot");
    if (connection.controller.signal.aborted) return false;
    store.load(snapshot);
    release(connection, update);
    changed();
    return true;
  };
  // Drops the current connection and opens a new one when there is a directory.
  const open = (): Connection | undefined => {
    controller?.abort();
    clearTimeout(reconnect);
    if (!directory || stopped) return;
    controller = new AbortController();
    return { controller, directory, loading: true, buffered: [] };
  };
  const retry = (): void => {
    void connect();
  };
  const connect = async (): Promise<void> => {
    const connection = open();
    if (!connection) return;
    const current = connection.controller;
    const stream = listen(connection);
    void stream.catch(() => {});
    try {
      const snapshot = await rpc.snapshot(
        {},
        {
          location: { directory: connection.directory },
          signal: current.signal,
        },
      );
      if (!applySnapshot(snapshot, connection)) return;
      await stream;
      disconnect(current);
    } catch {
      disconnect(current);
    } finally {
      current.abort();
      await stream.catch(() => {});
      if (owns(current)) reconnect = setTimeout(retry, 1000);
    }
  };
  return {
    get directory(): string | undefined {
      return directory;
    },
    get state(): ReviewUiState {
      return store.state;
    },
    connect,
    retarget: (next: string | undefined): void => {
      directory = next;
      store.reset();
      changed();
      void connect();
    },
    sweep: (): void => {
      const expired = store.state.expire();
      if (expired.length) controller?.abort();
      if (expired.length || store.state.dismissResults().length) changed();
    },
    stop: (): void => {
      stopped = true;
      controller?.abort();
      clearTimeout(reconnect);
    },
  };
}
