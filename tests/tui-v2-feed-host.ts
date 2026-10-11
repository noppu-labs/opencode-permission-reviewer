import { setupTuiV2, testRender } from "./tui-loader.ts";
import type { Host } from "./tui-v2-feed-data.ts";
import { reviewerClient } from "./tui-v2-feed-rpc.ts";

/** Starts the V2 TUI plugin against a fake host and renders its slot. */

type Context = Parameters<typeof setupTuiV2>[0];

function context(state: Host, slot: { render: () => unknown }): Context {
  const pushMode = (): (() => void) => {
    if (state.mode.throws) throw new Error("unknown mode");
    state.mode.depth++;
    return (): void => {
      state.mode.depth--;
    };
  };
  const ctx = {
    get location(): Host["location"] {
      return state.location;
    },
    data: { session: { get: (): Host["session"] => state.session } },
    keymap: { mode: { push: pushMode } },
    ui: {
      router: { current: (): Host["route"] => state.route },
      toast: {
        show: (value: Host["toasts"][number]): number =>
          state.toasts.push(value),
      },
      slot: (definition: { render(): unknown }): (() => void) => {
        slot.render = definition.render;
        return (): void => {};
      },
    },
    client: reviewerClient(state),
  };
  return ctx as unknown as Context;
}

export interface Running {
  state: Host;
  frame(): string;
  until(check: () => boolean, label: string, timeout?: number): Promise<void>;
  sees(text: string, present?: boolean): Promise<void>;
  dispose(): void;
}

const cleanups: Array<() => void> = [];
/** Disposes every plugin and renderer started since the last call. */
export function stopAll(): void {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
}

export async function start(state: Host): Promise<Running> {
  const slot = { render: (): unknown => null };
  const dispose = await setupTuiV2(context(state, slot));
  let disposed = false;
  const stop = (): void => {
    if (disposed) return;
    disposed = true;
    dispose();
  };
  cleanups.push(stop);
  const view = await testRender(() => slot.render() as Element, {
    width: 100,
    height: 24,
  });
  cleanups.push(() => view.renderer.destroy());
  const frame = (): string => view.captureCharFrame();
  const until = async (
    check: () => boolean,
    label: string,
    timeout = 3_000,
  ): Promise<void> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      // biome-ignore lint/performance/noAwaitInLoops: polls the fake host until the condition holds or the deadline passes
      await view.flush();
      if (check()) return;
      await Bun.sleep(10);
    }
    throw new Error(`timed out waiting for ${label}:\n${frame()}`);
  };
  const sees = (text: string, present = true): Promise<void> =>
    until(() => frame().includes(text) === present, text);
  return { state, frame, until, sees, dispose: stop };
}
