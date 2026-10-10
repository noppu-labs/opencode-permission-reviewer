import { expect, test } from "bun:test";
import { createUiStatus } from "../src/ui-protocol.ts";
import { defined, request } from "./helpers.ts";
import { resolveReviewTheme, setupTuiV2, testRender } from "./tui-loader.ts";

test("TUI resolves nested, flat, and unavailable host themes", () => {
  expect(
    resolveReviewTheme({
      background: { surface: { overlay: "nested-background" } },
      text: {
        default: "nested-text",
        subdued: "nested-muted",
        status: { running: "nested-info" },
        feedback: {
          success: { default: "nested-success" },
          error: { default: "nested-error" },
        },
      },
    }),
  ).toEqual({
    backgroundPanel: "nested-background",
    text: "nested-text",
    textMuted: "nested-muted",
    info: "nested-info",
    success: "nested-success",
    error: "nested-error",
  });
  expect(
    resolveReviewTheme({
      background: { raised: { base: "current-background" } },
      text: {
        base: "current-text",
        muted: "current-muted",
        feedback: {
          info: { base: "current-info" },
          success: { base: "current-success" },
          error: { base: "current-error" },
        },
      },
    }),
  ).toEqual({
    backgroundPanel: "current-background",
    text: "current-text",
    textMuted: "current-muted",
    info: "current-info",
    success: "current-success",
    error: "current-error",
  });
  expect(
    resolveReviewTheme({
      backgroundPanel: "flat-background",
      text: "flat-text",
      textMuted: "flat-muted",
      info: "flat-info",
      success: "flat-success",
      error: "flat-error",
    }),
  ).toEqual({
    backgroundPanel: "flat-background",
    text: "flat-text",
    textMuted: "flat-muted",
    info: "flat-info",
    success: "flat-success",
    error: "flat-error",
  });
  expect(resolveReviewTheme(undefined)).toMatchObject({
    backgroundPanel: expect.any(String),
    text: expect.any(String),
  });
});

test("TUI restores authoritative snapshots after disconnect and isolates routes, revisions, and generations", async () => {
  const directory = "/workspace/fixture";
  let sessionID = "ses_main";
  let modeDepth = 0;
  let snapshots = 0;
  let releaseSnapshot!: () => void;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  let render!: () => unknown;
  const toasts: unknown[] = [];
  const reviewing = {
    ...createUiStatus(request(), "reviewing", {
      model: "fixture/reviewer",
      variant: "max",
      timeoutMs: 10000,
    }),
    action: `printf ${"long action ".repeat(30)}\nsecond line\tend`,
  };
  let snapshot = {
    directory,
    generation: "generation_first",
    revision: 1,
    reviews: [reviewing],
  };
  type Channel = { queue: unknown[]; ended: boolean; wake?: () => void };
  const channels: Channel[] = [];
  const ctx = {
    location: { directory },
    data: { session: { get: () => ({ location: { directory } }) } },
    keymap: {
      mode: {
        push: () => {
          modeDepth++;
          return () => {
            modeDepth--;
          };
        },
      },
    },
    ui: {
      router: { current: () => ({ type: "session", sessionID }) },
      toast: { show: (value: unknown) => toasts.push(value) },
      slot: (definition: { render(): unknown }) => {
        render = definition.render;
        return () => {};
      },
    },
    client: {
      event: {
        subscribe: () => {
          throw new Error(
            "TUI snapshot loading must not depend on a generic host event",
          );
        },
      },
      rpc: () => ({
        snapshot: async () => {
          snapshots++;
          if (snapshots > 1) await snapshotGate;
          return snapshot;
        },
        events: {
          subscribe: async function* (
            _name: string,
            { signal }: { signal: AbortSignal },
          ): AsyncGenerator<unknown, void, unknown> {
            const channel: Channel = { queue: [], ended: false };
            channels.push(channel);
            const wake = () => channel.wake?.();
            signal.addEventListener("abort", wake);
            try {
              while (!signal.aborted && !channel.ended) {
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
          },
        },
      }),
    },
  } as unknown as Parameters<typeof setupTuiV2>[0];
  const dispose = await setupTuiV2(ctx);
  const view = await testRender(() => render() as Element, {
    width: 100,
    height: 24,
  });
  const waitForFrame = async (text: string, present = true): Promise<void> => {
    const deadline = Date.now() + 3000;
    do {
      // biome-ignore lint/performance/noAwaitInLoops: polls the rendered frame until the text appears or the deadline passes
      await view.flush();
      if (view.captureCharFrame().includes(text) === present) return;
      await Bun.sleep(10);
    } while (Date.now() < deadline);
    expect(
      view.captureCharFrame().includes(text),
      view.captureCharFrame(),
    ).toBe(present);
  };
  try {
    await waitForFrame("Reviewing this permission");
    const progressFrame = view.captureCharFrame();
    const occupied = progressFrame.split("\n").filter((line) => line.trim());
    expect(occupied).toHaveLength(2);
    expect(progressFrame.split("\n").findIndex((line) => line.trim())).toBe(22);
    expect(occupied[0]).toContain("fixture/reviewer");
    expect(occupied[1]).toContain("printf long action");
    const firstElapsed = Number(progressFrame.match(/(\d+\.\d)s/)?.[1]);
    await Bun.sleep(700);
    await view.flush();
    expect(
      Number(view.captureCharFrame().match(/(\d+\.\d)s/)?.[1]),
    ).toBeGreaterThan(firstElapsed);
    expect(modeDepth).toBe(1);
    sessionID = "ses_other";
    await waitForFrame("Reviewing this permission", false);
    expect(modeDepth).toBe(0);
    sessionID = "ses_main";
    await waitForFrame("Reviewing this permission");
    expect(modeDepth).toBe(1);

    snapshot = {
      directory,
      generation: "generation_second",
      revision: 2,
      reviews: [
        createUiStatus(request(), "denied", {
          model: "fixture/reviewer",
          variant: "max",
          timeoutMs: 10000,
          reason: "Authoritative denial",
        }),
      ],
    };
    const firstChannel = defined(channels[0], "first channel");
    firstChannel.ended = true;
    firstChannel.wake?.();
    await waitForFrame("Review status unavailable");
    expect(view.captureCharFrame()).not.toContain("Review approved");
    expect(modeDepth).toBe(0);
    releaseSnapshot();
    await waitForFrame("Review blocked");
    expect(snapshots).toBe(2);
    expect(view.captureCharFrame()).toContain("Review blocked");
    const channel = defined(channels.at(-1), "latest channel");
    channel.queue.push(
      {
        location: { directory },
        data: {
          directory,
          revision: 999,
          status: createUiStatus(request(), "approved", {
            model: "fixture/reviewer",
            variant: "max",
            timeoutMs: 10000,
          }),
        },
      },
      {
        location: { directory },
        data: {
          directory,
          generation: "generation_second",
          revision: 1,
          status: createUiStatus(request(), "approved", {
            model: "fixture/reviewer",
            variant: "max",
            timeoutMs: 10000,
          }),
        },
      },
      {
        location: { directory: "/other" },
        data: {
          directory: "/other",
          generation: "generation_second",
          revision: 3,
          status: createUiStatus(request(), "manual", {
            model: "fixture/reviewer",
            variant: "max",
            timeoutMs: 10000,
          }),
        },
      },
    );
    channel.wake?.();
    await Bun.sleep(10);
    await view.flush();
    expect(view.captureCharFrame()).toContain("Review blocked");
    expect(view.captureCharFrame()).not.toContain("Review approved");
    expect(toasts).toHaveLength(0);
  } finally {
    releaseSnapshot();
    dispose();
    view.renderer.destroy();
  }
  expect(modeDepth).toBe(0);
}, 10000);
