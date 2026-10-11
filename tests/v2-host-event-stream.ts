// The V2 host event subscription the server harness hands to setup: queued
// events in arrival order until the host ends it, it fails or the subscriber
// aborts.
import type { OpenCodeEvent } from "@opencode/client";

export interface HostEventStream {
  subscribe: (options: {
    signal: AbortSignal;
  }) => AsyncGenerator<OpenCodeEvent>;
  push: (event: OpenCodeEvent) => void;
  /** Events pushed but not yet handed to the subscriber. */
  queued: () => number;
  end: () => void;
  fail: (error: Error) => void;
}

export function hostEventStream(): HostEventStream {
  const events: OpenCodeEvent[] = [];
  let resume: (() => void) | undefined;
  let ended = false;
  let failure: Error | undefined;
  const next = (): OpenCodeEvent | undefined => {
    if (failure) throw failure;
    return events.shift();
  };
  return {
    subscribe: async function* ({
      signal,
    }: {
      signal: AbortSignal;
    }): AsyncGenerator<OpenCodeEvent> {
      const wake = (): void => resume?.();
      signal.addEventListener("abort", wake);
      try {
        while (!signal.aborted && !ended) {
          const event = next();
          if (event) yield event;
          else {
            await new Promise<void>((resolve) => {
              resume = resolve;
            });
          }
        }
      } finally {
        signal.removeEventListener("abort", wake);
      }
    },
    push: (event: OpenCodeEvent): void => {
      events.push(event);
      resume?.();
    },
    queued: (): number => events.length,
    end: (): void => {
      ended = true;
      resume?.();
    },
    fail: (error: Error): void => {
      failure = error;
      resume?.();
    },
  };
}
