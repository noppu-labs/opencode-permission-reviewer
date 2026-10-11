import { spyOn } from "bun:test";

/** One-second timers held back from the real clock until a test fires them. */
export interface HeldTimers {
  /** How many held timers are still pending. */
  readonly pending: number;
  /** Runs every pending held timer, as if its second had passed. */
  fire(): void;
  /** Puts the real `setTimeout` and `clearTimeout` back and drops what is held. */
  restore(): void;
}

/** Holds every `setTimeout` of exactly 1000 ms until `fire` runs it, and lets
 *  `clearTimeout` cancel a held one. Other timers run as usual. */
export function holdOneSecondTimers(): HeldTimers {
  const setReal = globalThis.setTimeout;
  const clearReal = globalThis.clearTimeout;
  const held = new Map<object, () => void>();
  const set = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    ms?: number,
  ) => {
    if (ms !== 1000) return setReal(callback, ms);
    const handle = {};
    held.set(handle, callback);
    return handle;
  }) as unknown as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation(((
    handle?: unknown,
  ) => {
    if (!held.delete(handle as object))
      clearReal(handle as Parameters<typeof clearTimeout>[0]);
  }) as typeof clearTimeout);
  return {
    get pending(): number {
      return held.size;
    },
    fire: (): void => {
      const due = [...held.values()];
      held.clear();
      for (const callback of due) callback();
    },
    restore: (): void => {
      set.mockRestore();
      clear.mockRestore();
      held.clear();
    },
  };
}
