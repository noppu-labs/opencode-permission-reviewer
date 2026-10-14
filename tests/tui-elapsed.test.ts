import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import { setGlobalConfigPathForTests } from "../src/config/loader.ts";
import { createUiStatus, encodeUiStatus } from "../src/ui-protocol.ts";
import { defined, request } from "./helpers.ts";
import { testRender, tui } from "./tui-loader.ts";

const disposers: Array<() => void> = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  setGlobalConfigPathForTests(undefined);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
});

type EventHandler = (event: never) => void;

interface Panel {
  handlers: Map<string, EventHandler[]>;
  setup: Awaited<ReturnType<typeof testRender>>;
  readElapsed: () => number;
}

/** Mounts the panel with a reviewing ask pending and the global config pinned. */
async function startPanel(): Promise<Panel> {
  const configDir = mkdtempSync(join(tmpdir(), "reviewer-tui-config-"));
  tempDirs.push(configDir);
  const configPath = join(configDir, "permission-reviewer.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({ model: "fixture/shared", variant: "high" }),
  );
  setGlobalConfigPathForTests(configPath);
  const handlers = new Map<string, EventHandler[]>();
  let factory: (() => unknown) | undefined;

  const api = {
    lifecycle: { onDispose: (fn: () => void) => disposers.push(fn) },
    route: {
      current: { name: "session", params: { sessionID: "ses_main" } },
      register: (): (() => void) => (): void => {},
      navigate: () => {},
    },
    theme: {
      current: {
        success: "#0f0",
        error: "#f00",
        info: "#00f",
        text: "#eee",
        textMuted: "#999",
        backgroundPanel: "#111",
      },
      install: () => {},
    },
    event: {
      on: (type: string, handler: EventHandler) => {
        const list = handlers.get(type) ?? [];
        list.push(handler);
        handlers.set(type, list);
        return () => {};
      },
    },
    ui: { toast: () => {} },
    state: { session: { get: () => undefined } },
    mode: { current: () => "normal", push: (): (() => void) => (): void => {} },
    slots: {
      register: (plugin: { slots: { app?: () => unknown } }) => {
        factory = plugin.slots.app;
      },
    },
  } as unknown as TuiPluginApi;

  await tui(api, {}, {
    id: "opencode-permission-reviewer",
    source: "npm",
    spec: "opencode-permission-reviewer@1.3.1",
    target: "/plugin/target",
    first_time: Date.now(),
    last_time: Date.now(),
    time_changed: Date.now(),
    load_count: 1,
    fingerprint: "test",
    state: "first",
  } satisfies TuiPluginMeta);
  expect(factory).toBeFunction();

  for (const handler of handlers.get("permission.asked") ?? []) {
    handler({ type: "permission.asked", properties: request() } as never);
  }

  const setup = await testRender(
    // An accessor, so the slot re-runs on each status change as in the host.
    () => (() => defined(factory, "app slot factory")()) as unknown as Element,
    {
      width: 80,
      height: 24,
    },
  );
  disposers.push(() => setup.renderer.destroy());
  await setup.flush();
  expect(setup.captureCharFrame()).toContain("No action needed");

  const readElapsed = (): number => {
    const frame = setup.captureCharFrame();
    const match = frame.match(/(\d+\.\d)s/);
    expect(match, `elapsed text not found in frame:\n${frame}`).toBeDefined();
    return Number(match?.[1]);
  };
  return { handlers, setup, readElapsed };
}

/**
 * Headless render test for the review panel's live texts.
 *
 * The elapsed counter and the spinner are driven by a 250ms tick signal. A
 * text child that reads no signal while evaluating (e.g. an elapsed string
 * computed from Date.now() alone) is evaluated once at mount and freezes,
 * which is exactly the "seconds do not advance" regression this pins. The
 * solid transform comes from the shared tui-loader, so the panel here is
 * compiled exactly as the host compiles it, and the tick interval is left
 * running: the elapsed value must grow between captured frames.
 */
describe("tui panel live elapsed counter", () => {
  test("elapsed seconds advance while the reviewing panel is visible", async () => {
    const { setup, readElapsed } = await startPanel();
    expect(setup.captureCharFrame()).toContain("Reviewing this permission");
    expect(setup.captureCharFrame()).toContain("shared");
    expect(setup.captureCharFrame()).toContain("high");
    const first = readElapsed();
    // At least two 250ms ticks pass before the second capture.
    await Bun.sleep(700);
    await setup.flush();
    const second = readElapsed();
    expect(second).toBeGreaterThan(first);
  }, 10_000);

  test("elapsed seconds stay the total across a hand-off", async () => {
    const { handlers, setup, readElapsed } = await startPanel();
    expect(readElapsed()).toBeGreaterThanOrEqual(0);
    await Bun.sleep(600);
    const fire = (status: ReturnType<typeof createUiStatus>): void => {
      for (const handler of handlers.get("tui.command.execute") ?? [])
        handler({ properties: { command: encodeUiStatus(status) } } as never);
    };
    fire(
      createUiStatus(request(), "reviewing", {
        model: "fixture/shared",
        variant: "high",
        timeoutMs: 120_000,
      }),
    );
    fire(
      createUiStatus(request(), "reviewing", {
        model: "omniroute/auto/gpt-6-luna",
        variant: "medium",
        timeoutMs: 120_000,
        handoff: {
          from: "opencode/jev-1.13-free",
          to: "omniroute/auto/gpt-6-luna",
          trigger: "jev-escalate",
        },
      }),
    );
    await Bun.sleep(300);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("gpt-6-luna · reasoning medium");
    expect(setup.captureCharFrame()).toContain("after Jev's escalation");
    // The total since the ask, not the time since the hand-off.
    // 0.6 s is the sleep before the hand-off: above the ~0.3 s since it, with slack for a slow host.
    expect(readElapsed()).toBeGreaterThanOrEqual(0.6);
  }, 10_000);
});
