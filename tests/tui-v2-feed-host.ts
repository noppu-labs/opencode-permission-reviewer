import { holdOneSecondTimers, runEach } from "./held-timers.ts";
import { setupTuiV2, testRender } from "./tui-loader.ts";
import type { Host } from "./tui-v2-feed-data.ts";
import { reviewerClient } from "./tui-v2-feed-rpc.ts";

/** Starts the V2 TUI plugin against a fake host and renders its slot. */

type Context = Parameters<typeof setupTuiV2>[0];

function context(
  state: Host,
  slot: { render: () => unknown },
  sidebar: { render: () => unknown },
): Context {
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
      slot: (definition: {
        append?: string;
        render(): unknown;
      }): (() => void) => {
        if (definition.append === "sidebar.content")
          sidebar.render = definition.render;
        else slot.render = definition.render;
        return (): void => {};
      },
    },
    client: reviewerClient(state),
  };
  return ctx as unknown as Context;
}

/** One sidebar mounted once, so a test sees live updates on the same view. */
export interface SidebarView {
  /** Waits until the sidebar text does (or, with `present` false, does not)
   *  include `text`. */
  sees(text: string, present?: boolean): Promise<void>;
  frame(): string;
}

export interface Running {
  state: Host;
  frame(): string;
  until(check: () => boolean, label: string, timeout?: number): Promise<void>;
  sees(text: string, present?: boolean): Promise<void>;
  /** Waits until the feed schedules its 1 s reconnect, then fires it. */
  reconnect(): Promise<void>;
  /** Lets the feed settle past its 250 ms sweep, then fires every pending
   *  1 s timer as if its second had passed. */
  settle(): Promise<void>;
  /** Renders what the plugin put in the sidebar, afresh. */
  sidebarFrame(): Promise<string>;
  /** Mounts the sidebar once and keeps it for live-update assertions. */
  mountSidebar(): Promise<SidebarView>;
  dispose(): void;
}

const cleanups: Array<() => void> = [];
/** Disposes every plugin and renderer started since the last call. Every
 *  cleanup runs even when one throws, so the timer hold is always restored. */
export function stopAll(): void {
  runEach(cleanups.splice(0).reverse());
}

export async function start(state: Host): Promise<Running> {
  const slot = { render: (): unknown => null };
  const sidebar = { render: (): unknown => null };
  const timers = holdOneSecondTimers();
  cleanups.push(timers.restore);
  const dispose = await setupTuiV2(context(state, slot, sidebar));
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
      await view.flush();
      if (check()) return;
      await Bun.sleep(10);
    }
    throw new Error(`timed out waiting for ${label}:\n${frame()}`);
  };
  const sees = (text: string, present = true): Promise<void> =>
    until(() => frame().includes(text) === present, text);
  const reconnect = async (): Promise<void> => {
    await until(() => timers.pending > 0, "a scheduled reconnect");
    timers.fire();
  };
  const settle = async (): Promise<void> => {
    await Bun.sleep(300);
    timers.fire();
    await view.flush();
  };
  const sidebarFrame = async (): Promise<string> => {
    const sidebarView = await testRender(() => sidebar.render() as Element, {
      width: 80,
      height: 2,
    });
    cleanups.push(() => sidebarView.renderer.destroy());
    await sidebarView.flush();
    return sidebarView.captureCharFrame();
  };
  const mountSidebar = async (): Promise<SidebarView> => {
    const mounted = await testRender(() => sidebar.render() as Element, {
      width: 80,
      height: 2,
    });
    cleanups.push(() => mounted.renderer.destroy());
    const sidebarText = (): string => mounted.captureCharFrame();
    return {
      frame: sidebarText,
      sees: (text: string, present = true): Promise<void> =>
        until(() => sidebarText().includes(text) === present, text),
    };
  };
  return {
    state,
    frame,
    until,
    sees,
    reconnect,
    settle,
    sidebarFrame,
    mountSidebar,
    dispose: stop,
  };
}
