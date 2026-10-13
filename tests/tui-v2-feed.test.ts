import { afterEach, describe, expect, test } from "bun:test";
import {
  event,
  gate,
  host,
  latest,
  push,
  snapshot,
  status,
  update,
} from "./tui-v2-feed-data.ts";
import { start, stopAll } from "./tui-v2-feed-host.ts";

afterEach(stopAll);

describe("V2 TUI reviewer feed", () => {
  test("replays events buffered during the snapshot load after it, skipping revisions the snapshot covers", async () => {
    const now = Date.now();
    const loading = gate();
    const running = await start(host({ respond: [() => loading.promise] }));
    await running.until(() => running.state.channels.length === 1, "channel");
    // If the covered revision were applied, its newer approval would make the
    // older denial stale and the panel would read "Review approved".
    push(
      latest(running.state),
      event(update(1, status("approved", { emittedAt: now + 50 }))),
      event(
        update(
          2,
          status("denied", { emittedAt: now + 10, reason: "Buffered denial" }),
        ),
      ),
    );
    await Bun.sleep(20);
    loading.resolve(snapshot([status("reviewing", { emittedAt: now })]));
    await running.sees("Review blocked");
    expect(running.frame()).toContain("Buffered denial");
    expect(running.frame()).not.toContain("Review approved");
  });

  test("an event buffer overflow while loading marks reviews disconnected and reconnects", async () => {
    const loading = gate();
    const running = await start(
      host({
        respond: [
          () => loading.promise,
          () =>
            snapshot([status("reviewing")], { generation: "generation_two" }),
        ],
      }),
    );
    await running.until(() => running.state.channels.length === 1, "channel");
    const first = latest(running.state);
    push(first, ...Array.from({ length: 513 }, () => event({})));
    await Bun.sleep(20);
    loading.resolve(snapshot([status("reviewing")]));
    await running.sees("Review status unavailable");
    expect(running.frame()).toContain("Reconnecting to reviewer status");
    expect(running.state.mode.depth).toBe(0);
    expect(first.signal.aborted).toBe(true);
    await running.reconnect();
    await running.until(
      () => running.state.snapshots.length === 2,
      "reconnect snapshot",
    );
    await running.sees("Reviewing this permission");
    expect(running.state.mode.depth).toBe(1);
  });

  test("an event from another generation drops the connection and ignores what the aborted stream still yields", async () => {
    const running = await start(
      host({ respond: [() => snapshot([status("reviewing")])] }),
    );
    await running.sees("Reviewing this permission");
    const first = latest(running.state);
    first.drain = true;
    first.ended = true;
    push(
      first,
      event(update(5, status("denied"), { generation: "generation_two" })),
      event(update(9, status("approved", { emittedAt: Date.now() + 10 }))),
    );
    await running.sees("Review status unavailable");
    expect(first.signal.aborted).toBe(true);
    expect(running.frame()).not.toContain("Review approved");
    expect(running.frame()).not.toContain("Review blocked");
    await running.reconnect();
    await running.until(
      () => running.state.snapshots.length === 2,
      "reconnect snapshot",
    );
  });

  test("ignores events that are not objects, name another directory, lack a generation or carry no newer numeric revision", async () => {
    const now = Date.now();
    const running = await start(
      host({
        respond: [() => snapshot([status("reviewing", { emittedAt: now })])],
      }),
    );
    await running.sees("Reviewing this permission");
    const denied = status("denied", { emittedAt: now + 50 });
    push(
      latest(running.state),
      event(null),
      event(update(2, denied, { directory: "/other" })),
      event(update(2, denied, { generation: undefined })),
      event(update(2, denied, { generation: 2 })),
      event(update("2", denied)),
      event(update(1, denied)),
      event(update(2, denied), "/other"),
      event(update(2, status("approved", { emittedAt: now + 10 }))),
    );
    await running.sees("Review approved");
    expect(running.frame()).not.toContain("Review blocked");
    expect(running.state.snapshots).toHaveLength(1);
  });

  test("skips undecodable snapshot reviews and toasts manual ones with their reason or the default text", async () => {
    const running = await start(
      host({
        respond: [
          () =>
            snapshot([
              { version: 1, phase: "approved" },
              status("manual", { id: "per_2", reason: "Needs a human" }),
              status("manual", { id: "per_3" }),
              status("reviewing"),
            ]),
        ],
      }),
    );
    await running.sees("Reviewing this permission");
    expect(running.state.toasts).toEqual([
      {
        variant: "warning",
        title: "Manual review required",
        message: "Needs a human",
      },
      {
        variant: "warning",
        title: "Manual review required",
        message: "The host requires your decision.",
      },
    ]);
  });

  test("words a manual toast by its resolution", async () => {
    const running = await start(
      host({
        respond: [
          () =>
            snapshot([
              {
                ...status("manual", { reason: "Both unsure." }),
                model: "openai/gpt-6-luna",
                resolution: "reasoning-escalated",
              },
            ]),
        ],
      }),
    );
    await running.until(() => running.state.toasts.length === 1, "toast");
    expect(running.state.toasts).toEqual([
      {
        variant: "warning",
        title: "Manual review required",
        message:
          "gpt-6-luna reviewed this after Jev; it needs your approval: Both unsure.",
      },
    ]);
  });

  test("toasts a manual status that arrives as an event", async () => {
    const running = await start(
      host({ respond: [() => snapshot([status("reviewing")])] }),
    );
    await running.sees("Reviewing this permission");
    push(
      latest(running.state),
      event(update(2, status("manual", { emittedAt: Date.now() + 10 }))),
    );
    await running.until(() => running.state.toasts.length === 1, "toast");
    await running.sees("Reviewing this permission", false);
    expect(running.state.mode.depth).toBe(0);
  });

  test.each([
    ["another directory", snapshot([], { directory: "/other" })],
    ["no generation", snapshot([], { generation: undefined })],
    ["a non-numeric revision", snapshot([], { revision: "1" })],
    ["reviews that are not an array", snapshot([], { reviews: {} })],
    ["not an object", null],
  ])(
    "a snapshot with %s is treated as a disconnect and retried",
    async (_name, invalid) => {
      const running = await start(
        host({
          respond: [() => invalid, () => snapshot([status("reviewing")])],
        }),
      );
      await running.reconnect();
      await running.until(
        () => running.state.snapshots.length === 2,
        "retried snapshot",
      );
      await running.sees("Reviewing this permission");
    },
  );

  test("a snapshot request that fails marks reviews disconnected and retries", async () => {
    const running = await start(
      host({
        respond: [
          () => snapshot([status("reviewing")]),
          () => Promise.reject(new Error("offline")),
          () =>
            snapshot([status("reviewing")], { generation: "generation_two" }),
        ],
      }),
    );
    await running.sees("Reviewing this permission");
    const first = latest(running.state);
    first.ended = true;
    first.wake?.();
    await running.sees("Review status unavailable");
    await running.reconnect();
    await running.reconnect();
    await running.until(
      () => running.state.snapshots.length === 3,
      "second retry",
      4_000,
    );
    await running.sees("Reviewing this permission");
  }, 10_000);
});
