import { type Channel, type Host, snapshot } from "./tui-v2-feed-data.ts";

/** The fake reviewer RPC client: scripted snapshots and hand-fed event
 *  subscriptions, recorded on the shared host state. */

async function* subscription(
  state: Host,
  signal: AbortSignal,
): AsyncGenerator<unknown, void, unknown> {
  const channel: Channel = { signal, queue: [], ended: false, drain: false };
  state.channels.push(channel);
  const wake = (): void => channel.wake?.();
  signal.addEventListener("abort", wake);
  const draining = (): boolean => channel.drain && channel.queue.length > 0;
  try {
    while (draining() || !(signal.aborted || channel.ended)) {
      if (channel.queue.length) yield channel.queue.shift();
      else {
        // biome-ignore lint/performance/noAwaitInLoops: async generator that yields queued events in arrival order and otherwise waits for the next wake-up
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
  const subscribe = (
    _name: string,
    options: { signal: AbortSignal },
  ): AsyncGenerator<unknown, void, unknown> =>
    subscription(state, options.signal);
  return { rpc: () => ({ snapshot: snapshotCall, events: { subscribe } }) };
}
