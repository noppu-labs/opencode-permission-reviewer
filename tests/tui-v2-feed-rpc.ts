import { type Channel, type Host, snapshot } from "./tui-v2-feed-data.ts";

/** The fake reviewer RPC client: scripted snapshots and hand-fed event
 *  subscriptions, recorded on the shared host state. */

/** A hand-fed subscription: a new channel on `channels` that yields what is
 *  queued on it until it ends or `signal` aborts (with `drain` set, until its
 *  queue is also empty). */
export async function* subscription(
  channels: Channel[],
  signal: AbortSignal,
): AsyncGenerator<unknown, void, unknown> {
  const channel: Channel = { signal, queue: [], ended: false, drain: false };
  channels.push(channel);
  const wake = (): void => channel.wake?.();
  signal.addEventListener("abort", wake);
  const draining = (): boolean => channel.drain && channel.queue.length > 0;
  try {
    while (draining() || !(signal.aborted || channel.ended)) {
      if (channel.queue.length) yield channel.queue.shift();
      else {
        await new Promise<void>((resolve) => {
          channel.wake = resolve;
        });
      }
    }
  } finally {
    signal.removeEventListener("abort", wake);
  }
}

export function reviewerClient(state: Host): unknown {
  const snapshotCall = (
    _input: unknown,
    options: { location: { directory: string } },
  ): Promise<unknown> => {
    const { directory } = options.location;
    state.snapshots.push(directory);
    const respond = state.respond.shift() ?? ((): unknown => snapshot([]));
    return Promise.resolve(respond(directory));
  };
  const statusCall = (
    _input: unknown,
    options: { location: { directory: string } },
  ): Promise<unknown> => {
    const { directory } = options.location;
    state.statusCalls.push(directory);
    return state.status === undefined
      ? Promise.reject(new Error("status is not available"))
      : Promise.resolve(state.status(directory));
  };
  const subscribe = (
    _name: string,
    options: { signal: AbortSignal },
  ): AsyncGenerator<unknown, void, unknown> =>
    subscription(state.channels, options.signal);
  return {
    rpc: () => ({
      snapshot: snapshotCall,
      status: statusCall,
      events: { subscribe },
    }),
  };
}
