import { afterEach, describe, expect, test } from "bun:test";
import { FIND_ACTION, FIND_SEGMENTS } from "./action-fixtures.ts";
import {
  DIRECTORY,
  event,
  gate,
  type Host,
  host,
  latest,
  moveTo,
  push,
  SECOND,
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
          "gpt-6-luna reviewed this after System One; it needs your approval: Both unsure.",
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

  const INERT =
    'systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; System One escalations still go to you';

  test("reads config warnings from the status RPC and keeps a sidebar line", async () => {
    const running = await start(
      host({
        status: () => ({ configWarnings: [INERT], configDegraded: [] }),
        respond: [() => snapshot([status("reviewing")])],
      }),
    );
    await running.until(
      () => running.state.toasts.length === 1,
      "config toast",
    );
    expect(running.state.statusCalls).toEqual([DIRECTORY]);
    expect(running.state.toasts).toEqual([
      {
        variant: "warning",
        title: "Permission reviewer config",
        message: INERT,
      },
    ]);
    expect(await running.sidebarFrame()).toContain(
      "⚠ reviewer: reasoning-first inactive (no escalationReviewer)",
    );
  });

  test("an older server without the status call keeps the feed working with no notice", async () => {
    const running = await start(
      host({ respond: [() => snapshot([status("reviewing")])] }),
    );
    await running.sees("Reviewing this permission");
    expect(running.state.statusCalls).toEqual([DIRECTORY]);
    expect(running.state.toasts).toEqual([]);
    expect(await running.sidebarFrame()).not.toContain("reviewer:");
  });

  test("malformed config lists keep only their strings", async () => {
    const running = await start(
      host({
        status: () => ({
          configWarnings: "broken",
          configDegraded: [1, "fs broken"],
        }),
        respond: [() => snapshot([status("reviewing")])],
      }),
    );
    await running.until(
      () => running.state.toasts.length === 1,
      "config toast",
    );
    expect(running.state.toasts).toEqual([
      {
        variant: "error",
        title: "Permission reviewer config degraded",
        message: "Automatic approval is disabled: fs broken.",
      },
    ]);
    expect(await running.sidebarFrame()).toContain(
      "✕ reviewer: auto-approval disabled (fs broken)",
    );
  });

  test("the mounted sidebar follows the status answer and a directory change", async () => {
    const pending = gate();
    const running = await start(
      host({
        status: (directory: string): unknown =>
          directory === DIRECTORY ? pending.promise : {},
        respond: [() => snapshot([status("reviewing")])],
      }),
    );
    const sidebar = await running.mountSidebar();
    await running.sees("Reviewing this permission");
    expect(sidebar.frame()).not.toContain("reviewer:");
    pending.resolve({ configWarnings: [INERT] });
    await sidebar.sees("reasoning-first inactive");
    moveTo(running.state, SECOND);
    await sidebar.sees("reviewer:", false);
  });

  test("renders a segmented action fitted to the terminal width", async () => {
    const long = {
      ...status("reviewing"),
      action: FIND_ACTION,
      actionSegments: FIND_SEGMENTS,
    };
    const running = await start(host({ respond: [() => snapshot([long])] }));
    await running.sees("⋯ 5 more ⋯ sh");
    expect(running.frame()).toContain(
      "bash · $ find . -name '*.ts' -not -path './node_modules/*' | ⋯ 5 more ⋯ sh",
    );
  });

  const BUDGET_REASON =
    "No review time left for the reasoning reviewer after System One escalated: 4s of the review budget remain and a hand-off needs 15s. Jev was unsure.";
  const BUDGET_REST =
    "4s of the review budget remain and a hand-off needs 15s. Jev was unsure.";

  async function budgetToastMessage(
    statusAnswer: Partial<Host>,
  ): Promise<string | undefined> {
    const running = await start(
      host({
        ...statusAnswer,
        respond: [() => snapshot([status("reviewing")])],
      }),
    );
    await running.sees("Reviewing this permission");
    push(
      latest(running.state),
      event(
        update(2, {
          ...status("manual", { reason: BUDGET_REASON }),
          resolution: "budget-exhausted",
        }),
      ),
    );
    await running.until(
      () => running.state.toasts.length === 1,
      "budget toast",
    );
    return running.state.toasts[0]?.message;
  }

  test("the budget toast names the reasoning reviewer's model from the status RPC", async () => {
    expect(
      await budgetToastMessage({
        status: () => ({
          escalationReviewerModel: "omniroute/auto/gpt-6-luna",
        }),
      }),
    ).toBe(
      `No review time left for gpt-6-luna after System One (System One escalated). ${BUDGET_REST}`,
    );
  });

  test("without a model from the status RPC the budget toast keeps the generic name", async () => {
    expect(await budgetToastMessage({})).toBe(
      `No review time left for the reasoning reviewer after System One (System One escalated). ${BUDGET_REST}`,
    );
  });

  test("after a directory change the budget toast drops the previous server's model", async () => {
    const budget = (directory: string): ReturnType<typeof event> =>
      event(
        update(
          2,
          {
            ...status("manual", { reason: BUDGET_REASON }),
            resolution: "budget-exhausted",
          },
          { directory },
        ),
        directory,
      );
    const state = host({
      status: (directory: string): unknown =>
        directory === DIRECTORY
          ? { escalationReviewerModel: "omniroute/auto/gpt-6-luna" }
          : Promise.reject(new Error("older server")),
      respond: [
        () => snapshot([status("reviewing")]),
        (directory: string) => snapshot([status("reviewing")], { directory }),
      ],
    });
    const running = await start(state);
    await running.sees("Reviewing this permission");
    push(latest(state), budget(DIRECTORY));
    await running.until(() => state.toasts.length === 1, "first toast");
    expect(state.toasts[0]?.message).toContain(
      "for gpt-6-luna after System One",
    );
    moveTo(state, SECOND);
    await running.until(() => state.snapshots.length === 2, "second snapshot");
    await running.sees("Reviewing this permission");
    push(latest(state), budget(SECOND));
    await running.until(() => state.toasts.length === 2, "second toast");
    expect(state.toasts[1]?.message).toBe(
      `No review time left for the reasoning reviewer after System One (System One escalated). ${BUDGET_REST}`,
    );
  });
});
