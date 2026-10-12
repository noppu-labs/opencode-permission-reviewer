import { spyOn } from "bun:test";

/** One-second timers held back from the real clock until a test fires them. */
export interface HeldTimers {
  readonly pending: number;
  /** Runs every pending held timer, as if its second had passed. */
  fire(): void;
  /** Puts the real `setTimeout` and `clearTimeout` back and drops what is held. */
  restore(): void;
}

type Handle = ReturnType<typeof setTimeout>;

let installed = false;

/** Runs every callback even when one throws, then rethrows what failed. */
export function runEach(callbacks: Iterable<() => void>): void {
  const errors: unknown[] = [];
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "callbacks failed");
}

/** Holds every `setTimeout` of exactly 1000 ms until `fire` runs it, and lets
 *  `clearTimeout` cancel a held one. Other timers run as usual. Throws when
 *  another hold is installed: Bun returns the same spy, so the second hold's
 *  real `setTimeout` would be the mock. */
export function holdOneSecondTimers(): HeldTimers {
  if (installed)
    throw new Error(
      "holdOneSecondTimers: already installed; call restore first",
    );
  installed = true;
  const setReal = globalThis.setTimeout;
  const clearReal = globalThis.clearTimeout;
  const held = new Map<Handle, () => void>();
  const set = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): Handle => {
    if (ms !== 1000) return setReal(callback, ms, ...args);
    // A real, already-cleared timer, so the handle keeps the Timer methods.
    const handle = setReal(() => {}, 0);
    clearReal(handle);
    held.set(handle, () => callback(...args));
    return handle;
  }) as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation(((
    handle?: Handle,
  ) => {
    if (handle === undefined || !held.delete(handle)) clearReal(handle);
  }) as typeof clearTimeout);
  return {
    get pending(): number {
      return held.size;
    },
    fire: (): void => {
      const due = [...held.values()];
      held.clear();
      runEach(due);
    },
    restore: (): void => {
      set.mockRestore();
      clear.mockRestore();
      held.clear();
      installed = false;
    },
  };
}
