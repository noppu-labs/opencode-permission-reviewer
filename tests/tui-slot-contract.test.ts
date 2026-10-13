import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import { setGlobalConfigPathForTests } from "../src/config/loader.ts";
import {
  createUiStatus,
  encodeUiStatus,
  type ReviewUiStatus,
} from "../src/ui-protocol.ts";
import { ReviewUiState } from "../src/ui-state.ts";
import { defined, request } from "./helpers.ts";
import { tui } from "./tui-loader.ts";

/**
 * Headless contract tests for the TUI overlay and result slots.
 *
 * The host renders each slot by invoking its factory inside a tracked
 * computation, and it only re-invokes the factory when the factory
 * body itself reads a Solid signal. That contract is what keeps the overlay
 * alive: a factory that reads no signal directly renders exactly once at boot
 * and npm-installed plugins then never show any panel (the slot view is not
 * re-created for them). These tests pin the parts of that contract that can be
 * checked without a real terminal renderer:
 *
 * - the factory reflects the current state on every (re-)invocation, using the
 *   "No renderer found" throw as proof that a panel render was attempted
 *   (element creation needs a renderer; nothing is created when idle);
 * - event wiring updates the shared state machine (asked/replied/decisions);
 * - the review mode is released independently of result rendering;
 * - manual outcomes toast instead of occupying the panel slot;
 * - the factory source still reads the revision signal directly.
 */

const disposers: Array<() => void> = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  setGlobalConfigPathForTests(undefined);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
});

/** Points the loader at a temp global config so a developer's own file never
 *  reaches a test. An absent `contents` means no global file. */
function pinGlobalConfig(contents?: Record<string, unknown>): void {
  const dir = mkdtempSync(join(tmpdir(), "reviewer-tui-global-"));
  tempDirs.push(dir);
  const path = join(dir, "permission-reviewer.jsonc");
  if (contents !== undefined) writeFileSync(path, JSON.stringify(contents));
  setGlobalConfigPathForTests(path);
}

type EventHandler = (event: never) => void;

interface CapturedApi {
  api: TuiPluginApi;
  handlers: Map<string, EventHandler[]>;
  factories: Partial<
    Record<"app" | "app_bottom" | "sidebar_content", () => unknown>
  >;
  /** By-reference mode bookkeeping: a bare number would be snapshotted. */
  mode: { pushes: string[]; pops: number };
  toasts: Array<{
    variant?: string;
    title?: string;
    message?: string;
    duration?: number;
  }>;
  dispose: () => void;
}

async function captureOverlay(
  options: Record<string, unknown> = {},
): Promise<CapturedApi> {
  const handlers = new Map<string, EventHandler[]>();
  const mode = { pushes: [] as string[], pops: 0 };
  const toasts: Array<{
    variant?: string;
    title?: string;
    message?: string;
    duration?: number;
  }> = [];
  let factories: Partial<
    Record<"app" | "app_bottom" | "sidebar_content", () => unknown>
  > = {};

  let dispose = (): void => {};
  const api = {
    lifecycle: {
      onDispose: (fn: () => void) => {
        dispose = fn;
        disposers.push(fn);
      },
    },
    route: {
      current: { name: "session", params: { sessionID: "ses_main" } },
      register: () => (): void => {},
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
    ui: {
      toast: (input: CapturedApi["toasts"][number]) => void toasts.push(input),
    },
    state: { session: { get: () => undefined } },
    mode: {
      current: () => "normal",
      push: (name: string) => {
        mode.pushes.push(name);
        return () => {
          mode.pops++;
        };
      },
    },
    slots: {
      register: (plugin: { slots: CapturedApi["factories"] }) => {
        factories = plugin.slots;
      },
    },
  } as unknown as TuiPluginApi;

  await tui(api, options, {
    id: "opencode-permission-reviewer",
    source: "npm",
    spec: "opencode-permission-reviewer@1.2.4",
    target: "/plugin/target",
    first_time: Date.now(),
    last_time: Date.now(),
    time_changed: Date.now(),
    load_count: 1,
    fingerprint: "test",
    state: "first",
  } satisfies TuiPluginMeta);
  return { api, handlers, factories, mode, toasts, dispose };
}

function fire(captured: CapturedApi, type: string, event: unknown): void {
  for (const handler of captured.handlers.get(type) ?? [])
    handler(event as never);
}

/** Invokes the factory; reports whether it attempted to create panel elements.
 *  Element creation without a renderer throws, which is exactly the evidence
 *  we want: an idle factory returns a falsy value without touching elements. */
function factoryAttempt(
  captured: CapturedApi,
  slot: "app" | "app_bottom" | "sidebar_content" = "app",
): { rendered: boolean; threw: boolean } {
  const factory = captured.factories[slot];
  expect(factory).toBeFunction();
  const slotFactory = defined(factory, `${slot} factory`);
  try {
    slotFactory();
    return { rendered: false, threw: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { rendered: message.includes("No renderer found"), threw: true };
  }
}

function statusEvent(
  phase: "approved" | "denied" | "manual",
  overrides: Record<string, unknown> = {},
): { properties: { command: string } } {
  const status = createUiStatus(request(), phase, {
    model: "test-model",
    variant: "high",
    timeoutMs: 60_000,
    reason: "test reason",
    emittedAt: Date.now(),
    ...overrides,
  });
  return { properties: { command: encodeUiStatus(status) } };
}

describe("tui overlay slot contract", () => {
  test("registers separate overlay and result slots and subscribes to the event trio", async () => {
    const captured = await captureOverlay();
    expect(Object.keys(captured.factories).sort()).toEqual([
      "app",
      "app_bottom",
      "sidebar_content",
    ]);
    expect([...captured.handlers.keys()].sort()).toEqual([
      "permission.asked",
      "permission.replied",
      "tui.command.execute",
    ]);
  });

  test("config warnings toast once per session and keep a sidebar line until they clear", async () => {
    const captured = await captureOverlay();
    const warning =
      'systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; Jev escalations still go to you';
    expect(factoryAttempt(captured, "sidebar_content").threw).toBe(false);
    fire(
      captured,
      "tui.command.execute",
      statusEvent("approved", { configWarnings: [warning] }),
    );
    fire(
      captured,
      "tui.command.execute",
      statusEvent("approved", {
        configWarnings: [warning],
        emittedAt: Date.now() + 10,
      }),
    );
    expect(captured.toasts).toEqual([
      {
        variant: "warning",
        title: "Permission reviewer config",
        message: warning,
        duration: 8_000,
      },
    ]);
    expect(factoryAttempt(captured, "sidebar_content").rendered).toBe(true);
    fire(
      captured,
      "tui.command.execute",
      statusEvent("denied", { emittedAt: Date.now() + 20 }),
    );
    expect(factoryAttempt(captured, "sidebar_content").threw).toBe(false);
  });

  test("idle factory renders nothing and pushes no mode", async () => {
    const captured = await captureOverlay();
    const attempt = factoryAttempt(captured);
    expect(attempt.threw).toBe(false);
    expect(factoryAttempt(captured, "app_bottom").threw).toBe(false);
    expect(captured.mode.pushes).toHaveLength(0);
  });

  test("a permission ask renders only the overlay and pushes the review mode", async () => {
    const captured = await captureOverlay();
    fire(captured, "permission.asked", {
      type: "permission.asked",
      properties: request(),
    });

    const attempt = factoryAttempt(captured);
    expect(attempt.rendered).toBe(true);
    expect(factoryAttempt(captured, "app_bottom").threw).toBe(false);
    expect(captured.mode.pushes).toEqual(["permission-reviewer"]);
    expect(captured.mode.pops).toBe(0);
  });

  test("an approved decision moves to the bottom strip, releases the mode, and survives the reply", async () => {
    const captured = await captureOverlay();
    fire(captured, "permission.asked", {
      type: "permission.asked",
      properties: request(),
    });
    fire(captured, "tui.command.execute", statusEvent("approved"));
    fire(captured, "permission.replied", {
      properties: { requestID: "per_1" },
    });

    expect(factoryAttempt(captured).threw).toBe(false);
    expect(factoryAttempt(captured, "app_bottom").rendered).toBe(true);
    expect(captured.mode.pops).toBe(1);
  });

  test("a reply to an unresolved review clears the panel and pops the mode", async () => {
    const captured = await captureOverlay();
    fire(captured, "permission.asked", {
      type: "permission.asked",
      properties: request(),
    });
    const first = factoryAttempt(captured);
    expect(first.rendered).toBe(true);

    fire(captured, "permission.replied", {
      properties: { requestID: "per_1" },
    });
    const attempt = factoryAttempt(captured);
    expect(attempt.threw).toBe(false);
    expect(factoryAttempt(captured, "app_bottom").threw).toBe(false);
    expect(captured.mode.pops).toBe(1);
  });

  test("a manual outcome toasts and never occupies the panel or the mode", async () => {
    const captured = await captureOverlay();
    fire(captured, "permission.asked", {
      type: "permission.asked",
      properties: request(),
    });
    fire(captured, "tui.command.execute", statusEvent("manual"));

    expect(captured.toasts.map((t) => t.title)).toEqual([
      "Manual review required",
    ]);
    const attempt = factoryAttempt(captured);
    expect(attempt.threw).toBe(false);
    expect(factoryAttempt(captured, "app_bottom").threw).toBe(false);
    expect(captured.mode.pushes).toEqual(["permission-reviewer"]);
    expect(captured.mode.pops).toBe(1);
  });

  test("a manual outcome after an unavailable reasoning reviewer toasts as an error", async () => {
    const captured = await captureOverlay();
    fire(
      captured,
      "tui.command.execute",
      statusEvent("manual", {
        model: "openai/gpt-6-luna",
        resolution: "reasoning-unavailable",
        reason: "reasoning reviewer failed (TimeoutError): slow",
      }),
    );
    expect(captured.toasts).toEqual([
      {
        variant: "error",
        title: "Reasoning reviewer unavailable",
        message:
          "gpt-6-luna failed (timeout). This permission needs your approval. reasoning reviewer failed (TimeoutError): slow",
        duration: 8_000,
      },
    ]);
  });

  test("a terminal result after the reply does not reacquire the mode", async () => {
    const captured = await captureOverlay();
    fire(captured, "permission.asked", {
      type: "permission.asked",
      properties: request(),
    });
    fire(captured, "permission.replied", {
      properties: { requestID: "per_1" },
    });
    expect(captured.mode.pops).toBe(1);
    fire(captured, "tui.command.execute", statusEvent("denied"));
    expect(factoryAttempt(captured).threw).toBe(false);
    expect(factoryAttempt(captured, "app_bottom").rendered).toBe(true);
    expect(captured.mode.pushes).toEqual(["permission-reviewer"]);
    expect(captured.mode.pops).toBe(1);
  });

  test("disposal releases the active mode only once", async () => {
    const captured = await captureOverlay();
    fire(captured, "permission.asked", {
      type: "permission.asked",
      properties: request(),
    });
    captured.dispose();
    captured.dispose();
    expect(captured.mode.pops).toBe(1);
  });

  test("factory body reads the revision signal directly (host re-render contract)", async () => {
    const captured = await captureOverlay();
    // The host only re-invokes the app factory when the factory itself reads a
    // signal during execution. If this tripwire fails, the overlay renders
    // once at boot and npm-installed plugins never show panels again.
    for (const factory of Object.values(captured.factories)) {
      expect(factory.toString()).toMatch(/\brevision\s*\(/);
    }
  });

  test("events for other sessions never activate the panel", async () => {
    const captured = await captureOverlay();
    const foreign = request({ id: "per_other", sessionID: "ses_elsewhere" });
    fire(captured, "permission.asked", {
      type: "permission.asked",
      properties: foreign,
    });

    const attempt = factoryAttempt(captured);
    expect(attempt.threw).toBe(false);
    expect(factoryAttempt(captured, "app_bottom").threw).toBe(false);
    expect(captured.mode.pushes).toHaveLength(0);
  });
});

/** The inline view the server never sees: it loads inline options as unknown
 *  origin, so these routing keys and this escalationReviewer are dropped. */
const DROPPED_INLINE = {
  systemOneEscalation: "reasoning-first",
  escalationReviewer: { model: "openai/gpt-6", timeoutMs: 600_000 },
};

describe("tui config comes from the server's view", () => {
  test("inline routing keys neither warn nor toast nor leave a sidebar line", async () => {
    pinGlobalConfig();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const captured = await captureOverlay(DROPPED_INLINE);
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([]);
      // A clean server status: the inline keys leave nothing behind to show.
      fire(captured, "tui.command.execute", statusEvent("approved"));
      expect(captured.toasts).toEqual([]);
      expect(factoryAttempt(captured, "sidebar_content").rendered).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  test("routing warnings of the global file reach the TUI only through server statuses", async () => {
    pinGlobalConfig({ systemOneEscalation: "reasoning-first" });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const captured = await captureOverlay();
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([]);
      expect(captured.toasts).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  test("the placeholder budget ignores an inline escalationReviewer the server drops", async () => {
    pinGlobalConfig({ timeoutMs: 90_000 });
    const asked = spyOn(ReviewUiState.prototype, "asked");
    try {
      const captured = await captureOverlay(DROPPED_INLINE);
      fire(captured, "permission.asked", {
        type: "permission.asked",
        properties: request(),
      });
      expect(
        asked.mock.results.map(
          (result) => (result.value as ReviewUiStatus).timeoutMs,
        ),
      ).toEqual([2 * 90_000 + 60_000]);
    } finally {
      asked.mockRestore();
    }
  });

  test("the watchdog follows the timeout of the server status", async () => {
    pinGlobalConfig({ timeoutMs: 90_000 });
    // Capture the 250ms watchdog ticker so the test drives it by hand, and pin
    // the clock, instead of waiting on real time.
    let tick: (() => void) | undefined;
    const interval = spyOn(globalThis, "setInterval").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      if (ms === 250) tick = fn;
      return 0;
    }) as unknown as typeof setInterval);
    const realNow = Date.now.bind(Date);
    const startedAt = realNow();
    let offsetMs = 0;
    const clock = spyOn(Date, "now").mockImplementation(
      () => startedAt + offsetMs,
    );
    try {
      const captured = await captureOverlay(DROPPED_INLINE);
      const runTick = defined(tick, "watchdog ticker");
      fire(captured, "permission.asked", {
        type: "permission.asked",
        properties: request(),
      });
      fire(captured, "tui.command.execute", {
        properties: {
          command: encodeUiStatus(
            createUiStatus(request(), "reviewing", {
              model: "test-model",
              variant: "high",
              timeoutMs: 30_000,
              emittedAt: startedAt,
            }),
          ),
        },
      });
      // Past the 15s start grace but before the server's 30s + 5s deadline: an
      // unacknowledged review would be gone, so this also proves the server
      // status was applied.
      offsetMs = 20_000;
      runTick();
      expect(factoryAttempt(captured, "app").rendered).toBe(true);
      expect(factoryAttempt(captured, "app_bottom").threw).toBe(false);
      // Past the server deadline, far inside the placeholder's 240s.
      offsetMs = 40_000;
      runTick();
      expect(factoryAttempt(captured, "app_bottom").rendered).toBe(true);
    } finally {
      clock.mockRestore();
      interval.mockRestore();
    }
  });
});
