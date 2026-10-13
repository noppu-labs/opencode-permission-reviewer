import { afterEach, describe, expect, test } from "bun:test";
import {
  DIRECTORY,
  event,
  type Gate,
  gate,
  host,
  latest,
  moveTo,
  SECOND,
  snapshot,
  status,
  update,
} from "./tui-v2-feed-data.ts";
import { start, stopAll } from "./tui-v2-feed-host.ts";

afterEach(stopAll);

function resolveWithDenial(pending: Gate): void {
  pending.resolve(snapshot([status("denied", { reason: "Old directory" })]));
}

function failSnapshot(pending: Gate): void {
  pending.reject(new Error("aborted"));
}

describe("V2 TUI reviewer feed routing and lifecycle", () => {
  test("keeps the panel when the host rejects the review mode", async () => {
    const running = await start(
      host({
        mode: { depth: 0, throws: true },
        respond: [() => snapshot([status("reviewing")])],
      }),
    );
    await running.sees("Reviewing this permission");
    expect(running.state.mode.depth).toBe(0);
  });

  test("does not connect without a directory", async () => {
    const running = await start(
      host({ location: undefined, route: { type: "home" } }),
    );
    await Bun.sleep(400);
    expect(running.state.snapshots).toEqual([]);
    expect(running.state.channels).toEqual([]);
  });

  test("uses the host location when the route is not a session", async () => {
    const running = await start(
      host({
        route: { type: "home" },
        respond: [() => snapshot([status("reviewing")])],
      }),
    );
    await running.until(() => running.state.snapshots.length === 1, "snapshot");
    await Bun.sleep(400);
    expect(running.state.snapshots).toEqual([DIRECTORY]);
    expect(running.frame()).not.toContain("Reviewing this permission");
  });

  test("falls back to the host location when the session has none", async () => {
    const running = await start(
      host({
        session: undefined,
        respond: [() => snapshot([status("reviewing")])],
      }),
    );
    await running.sees("Reviewing this permission");
    await Bun.sleep(400);
    expect(running.state.snapshots).toEqual([DIRECTORY]);
  });

  test.each([
    ["resolves", resolveWithDenial],
    ["fails", failSnapshot],
  ])(
    "follows the session's directory, and an old snapshot that %s afterwards changes nothing",
    async (_name, settle) => {
      const pending = gate();
      const state = host({
        respond: [
          () => pending.promise,
          (directory: string) => snapshot([status("reviewing")], { directory }),
        ],
      });
      const running = await start(state);
      await running.until(() => state.channels.length === 1, "first channel");
      const first = latest(state);
      moveTo(state, SECOND);
      await running.sees("Reviewing this permission");
      expect(state.snapshots).toEqual([DIRECTORY, SECOND]);
      expect(first.signal.aborted).toBe(true);
      settle(pending);
      await running.settle();
      expect(running.frame()).toContain("Reviewing this permission");
      expect(running.frame()).not.toContain("Old directory");
      expect(running.frame()).not.toContain("Review approved");
      expect(state.snapshots).toEqual([DIRECTORY, SECOND]);
    },
  );

  test("ignores what the previous subscription still yields after the directory changed", async () => {
    const state = host({
      respond: [
        () => snapshot([status("reviewing")]),
        (directory: string) => snapshot([], { directory }),
      ],
    });
    const running = await start(state);
    await running.sees("Reviewing this permission");
    const first = latest(state);
    // Queued without a wake-up, so it is only yielded once the directory
    // change aborts this subscription; it names the new directory and the
    // generation and revision the new snapshot accepts.
    first.drain = true;
    first.queue.push(
      event(update(2, status("approved"), { directory: SECOND })),
    );
    moveTo(state, SECOND);
    await running.until(() => state.snapshots.length === 2, "second snapshot");
    await running.sees("Reviewing this permission", false);
    await Bun.sleep(300);
    expect(first.signal.aborted).toBe(true);
    expect(first.queue).toEqual([]);
    expect(running.frame()).not.toContain("Review approved");
  });

  test("an expired review aborts the subscription and reconnects", async () => {
    const stale = {
      ...status("reviewing", { emittedAt: Date.now() - 60_000 }),
      timeoutMs: 1,
    };
    const running = await start(
      host({
        respond: [
          () => snapshot([stale]),
          () => snapshot([], { generation: "generation_two" }),
        ],
      }),
    );
    await running.until(() => running.state.channels.length === 1, "channel");
    const first = latest(running.state);
    await running.sees("Review status unavailable");
    expect(first.signal.aborted).toBe(true);
    await running.reconnect();
    await running.until(
      () => running.state.snapshots.length === 2,
      "reconnect snapshot",
    );
    await running.sees("Review status unavailable", false);
  });

  test("dispose aborts the subscription, releases the mode and stops reconnecting", async () => {
    const running = await start(
      host({ respond: [() => snapshot([status("reviewing")])] }),
    );
    await running.sees("Reviewing this permission");
    expect(running.state.mode.depth).toBe(1);
    const first = latest(running.state);
    running.dispose();
    expect(first.signal.aborted).toBe(true);
    expect(running.state.mode.depth).toBe(0);
    await running.settle();
    expect(running.state.snapshots).toHaveLength(1);
  });

  test("a snapshot that resolves after dispose is not applied and does not reconnect", async () => {
    const pending = gate();
    const running = await start(host({ respond: [() => pending.promise] }));
    await running.until(() => running.state.snapshots.length === 1, "snapshot");
    running.dispose();
    pending.resolve(snapshot([status("reviewing")]));
    await running.settle();
    expect(running.state.snapshots).toHaveLength(1);
    expect(running.state.mode.depth).toBe(0);
  });

  test("re-reads config warnings for a new directory without repeating a toast", async () => {
    const warning =
      "systemOneDenialReview is inactive: the reviewer model is not Jev";
    const state = host({
      // Both directories report the same warning: the second must not toast again.
      status: () => ({ configWarnings: [warning] }),
      respond: [
        () => snapshot([status("reviewing")]),
        (directory: string) => snapshot([], { directory }),
      ],
    });
    const running = await start(state);
    await running.until(() => state.toasts.length === 1, "first toast");
    moveTo(state, SECOND);
    await running.until(
      () => state.statusCalls.length === 2,
      "second status call",
    );
    await running.settle();
    expect(state.statusCalls).toEqual([DIRECTORY, SECOND]);
    expect(state.toasts).toHaveLength(1);
    expect(await running.sidebarFrame()).toContain(
      "denial review inactive (model is not Jev)",
    );
  });
});
