import { expect, test } from "bun:test";
import { holdOneSecondTimers } from "./held-timers.ts";
import { until } from "./poll-until.ts";
import {
  type Input,
  lifecycle,
  pendingReview,
  type ServerFixture,
} from "./v2-server-fixture.ts";

const { start, held, release, quietErrors } = lifecycle();

function toolEvent(id: string): {
  sessionID: string;
  messageID: string;
  id: string;
  input: unknown;
} {
  return {
    sessionID: "ses_main",
    messageID: "msg_tool",
    id,
    input: { filePath: "notes.txt" },
  };
}

function edit(harness: ServerFixture, id: string): Input {
  return {
    ...harness.input(),
    action: "edit",
    resources: ["notes.txt"],
    metadata: {},
    source: { type: "tool", messageID: "msg_tool", id },
  };
}

async function outcomeOf(harness: ServerFixture, id: string): Promise<Input> {
  const input = edit(harness, id);
  await harness.evaluate(input);
  return input;
}

const incomplete = {
  effect: "ask" as const,
  message:
    "Automatic approval is blocked: a material part of the pending action was elided or truncated in the reviewer evidence, so the model judged an incomplete view of the action.",
};

test("v2 reviews read the exact tool input retained by the tool hooks", async () => {
  const harness = await start();
  harness.tool("execute.before", toolEvent("call_kept"));
  expect((await outcomeOf(harness, "call_kept")).effect).toBe("allow");
  expect(await outcomeOf(harness, "call_unknown")).toMatchObject(incomplete);
  harness.tool("execute.after", toolEvent("call_kept"));
  expect(await outcomeOf(harness, "call_kept")).toMatchObject(incomplete);
  Array.from({ length: 513 }, (_, index) =>
    harness.tool("execute.before", toolEvent(`call_${index}`)),
  );
  expect(await outcomeOf(harness, "call_0")).toMatchObject(incomplete);
  expect((await outcomeOf(harness, "call_512")).effect).toBe("allow");
});

test("v2 reviews deny when the retained tool input is replaced during the review", async () => {
  const harness = await start({ delay: held() });
  const event = toolEvent("call_replaced");
  harness.tool("execute.before", event);
  const input = edit(harness, "call_replaced");
  const work = harness.evaluate(input);
  await harness.started(1);
  event.input = { filePath: "other.txt" };
  release();
  await work;
  expect(input.effect).toBe("deny");
  expect(input.message).toBe("Pending action changed during its review");
});

test.each([
  { type: "session.deleted", data: { sessionID: "ses_main" } },
  { type: "session.execution.interrupted", data: { sessionID: "ses_main" } },
])(
  "v2 host events: $type without a location cancels the session's review and other events are ignored",
  async (cancel) => {
    const harness = await start({ delay: held() });
    const { input, work } = await pendingReview(harness);
    const located = { location: { directory: harness.directory } };
    harness.send({
      type: "session.updated",
      data: { sessionID: "ses_main" },
      ...located,
    });
    harness.send({ type: "session.deleted", ...located });
    harness.send({
      type: "session.deleted",
      data: { sessionID: "ses_other" },
      ...located,
    });
    await until(
      () => harness.queuedEvents() === 0,
      "the server to take every host event",
    );
    expect(input.effect).toBe("ask");
    harness.send(cancel);
    await work;
    expect(input.effect).toBe("deny");
    expect(input.message).toBe(
      "Review was cancelled or its total deadline expired",
    );
  },
);

test("v2 host event failures are logged and later reviews are denied with the reason", async () => {
  const errors = quietErrors();
  const harness = await start();
  harness.failEvents(new Error("stream reset"));
  await until(
    () => errors.mock.calls.length > 0,
    "the subscription failure log",
  );
  expect(errors).toHaveBeenCalledWith(
    "[opencode-permission-reviewer] Host event subscription failed",
    "Error: stream reset",
  );
  expect(await harness.rpc.status()).toMatchObject({
    eventConnection: "unavailable",
  });
  const input = harness.input();
  await harness.evaluate(input);
  expect(input.effect).toBe("deny");
  expect(input.message).toBe("Reviewer host event connection is unavailable");
  await harness.dispose();
  const after = harness.input();
  await harness.evaluate(after);
  expect(after.message).toBe("Reviewer is shutting down");
  expect(harness.reviews()).toBe(0);
});

test.each([false, true])(
  "v2 UI publication failures are logged only when debug is %p",
  async (debug) => {
    const errors = quietErrors();
    const phases: string[] = [];
    const harness = await start({
      config: { debug },
      emit: async (_name: string, payload: unknown): Promise<void> => {
        phases.push((payload as { status: { phase: string } }).status.phase);
        throw new Error("UI gone");
      },
    });
    const input = harness.input();
    await harness.evaluate(input);
    expect(input.effect).toBe("allow");
    await until(
      () => phases.includes("approved"),
      "the final UI status publication",
    );
    const logged = errors.mock.calls.some(
      ([message]) =>
        message ===
        "[opencode-permission-reviewer] UI event publication failed",
    );
    expect(logged).toBe(debug);
  },
);

test("v2 shutdown logs a failed backend cleanup", async () => {
  const errors = quietErrors();
  const harness = await start({
    backendDispose: async (): Promise<void> => {
      throw new Error("cleanup failed");
    },
  });
  await harness.dispose();
  expect(errors).toHaveBeenCalledWith(
    "[opencode-permission-reviewer] Reviewer shutdown cleanup timed out",
    "Error: cleanup failed",
  );
});

async function evaluateBatch(
  harness: ServerFixture,
  batch: number,
): Promise<void> {
  await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      harness.evaluate(harness.input(`ses_${batch}_${index}`)),
    ),
  );
}

test("v2 UI statuses stay bounded and notifications past capacity are omitted", async () => {
  const errors = quietErrors();
  const harness = await start({
    emit: (_name: string, payload: unknown): Promise<void> =>
      (payload as { status: { phase: string } }).status.phase === "reviewing"
        ? Promise.resolve()
        : new Promise<void>(() => {}),
  });
  // UI publications are bounded by 1 s; holding that bound keeps them pending
  // however slow the runner is, so the notification queue still fills.
  const timers = holdOneSecondTimers();
  try {
    await Array.from({ length: 9 }).reduce<Promise<void>>(
      (previous, _, batch) =>
        previous.then(() => evaluateBatch(harness, batch)),
      Promise.resolve(),
    );
  } finally {
    timers.fire();
    timers.restore();
  }
  const reviews = (await harness.rpc.snapshot()).reviews as Array<{
    sessionID: string;
    phase: string;
  }>;
  expect(reviews).toHaveLength(256);
  expect(reviews.some((review) => review.sessionID === "ses_0_0")).toBe(false);
  expect(reviews.at(-1)?.phase).toBe("reviewing");
  expect(errors).toHaveBeenCalledWith(
    "[opencode-permission-reviewer] Review notification capacity exhausted; notification omitted",
    "",
  );
});
