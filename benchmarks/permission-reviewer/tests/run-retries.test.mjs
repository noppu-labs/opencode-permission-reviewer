import assert from "node:assert/strict";
import test from "node:test";
import { TEXT_RETRY_NOTE } from "../lib/providers.mjs";
import { runBenchmark } from "../lib/run.mjs";
import { success } from "./helpers.mjs";
import {
  failure,
  inSequence,
  inTemp,
  recordDelays,
  rowsOf,
  runInput,
  scripted,
} from "./run-fixtures.mjs";

test("transport retries back off exponentially to a 4 s cap, then keep the failure", async (t) =>
  inTemp(async (dir) => {
    const delays = recordDelays(t);
    const completion = scripted(failure(503));
    await runBenchmark({ ...runInput(dir, { httpRetries: 5 }, 1), completion });
    assert.equal(completion.requests.length, 6);
    assert.deepEqual(delays, [500, 1000, 2000, 4000, 4000]);
    const [row] = await rowsOf(dir);
    assert.equal(row.status, "transport-error");
    assert.equal(row.attempts.length, 6);
  }));

const retried = [
  [null, 2],
  [undefined, 2],
  [408, 2],
  [429, 2],
  [500, 2],
  [599, 2],
  [400, 1],
  [401, 1],
  [404, 1],
  [499, 1],
];

test("only null, undefined, 408, 429 and 5xx transport failures are retried", async (t) => {
  recordDelays(t);
  await inSequence(retried, ([status, expectedCalls]) =>
    inTemp(async (dir) => {
      const completion = scripted(failure(status));
      await runBenchmark({
        ...runInput(dir, { httpRetries: 1 }, 1),
        completion,
      });
      assert.equal(completion.requests.length, expectedCalls, `${status}`);
    }),
  );
});

test("a valid answer after a transport retry keeps a null first decision", async (t) =>
  inTemp(async (dir) => {
    recordDelays(t);
    await runBenchmark({
      ...runInput(dir, { httpRetries: 1 }, 1),
      completion: scripted(failure(503), success("deny")),
    });
    const [row] = await rowsOf(dir);
    assert.equal(row.status, "valid");
    assert.equal(row.firstDecision, null);
    assert.equal(row.decision.outcome, "deny");
    assert.equal(row.attempts.length, 2);
  }));

test("format retries resend with the retry note and stop at the limit", async () =>
  inTemp(async (dir) => {
    const completion = scripted({
      ok: true,
      status: 200,
      latencyMs: 1,
      extracted: { text: "?" },
    });
    await runBenchmark({
      ...runInput(dir, { formatRetries: 2, timeoutMs: 4321 }, 1),
      completion,
    });
    const keys = ["timeoutMs", "retryNote", "signal"];
    assert.deepEqual(
      completion.requests.map((r) => [
        Object.keys(r),
        r.timeoutMs,
        r.retryNote,
      ]),
      [
        [keys, 4321, undefined],
        [keys, 4321, TEXT_RETRY_NOTE],
        [keys, 4321, TEXT_RETRY_NOTE],
      ],
    );
    assert(completion.requests.every((r) => r.signal instanceof AbortSignal));
    const [row] = await rowsOf(dir);
    assert.equal(row.status, "invalid");
    assert.equal(row.attempts.length, 3);
  }));

const unusable = [
  { text: JSON.stringify({ version: 2 }), protocolError: "Refused." },
  undefined,
  {},
];

test("a protocol error, a missing extraction or missing text is an invalid answer", async () =>
  inSequence(unusable, (extracted) =>
    inTemp(async (dir) => {
      await runBenchmark({
        ...runInput(dir, {}, 1),
        completion: scripted({ ok: true, status: 200, extracted }),
      });
      const [row] = await rowsOf(dir);
      assert.equal(row.status, "invalid");
      assert.equal(row.decision, null);
      assert.equal(row.firstDecision, null);
    }),
  ));

test("request delays use the configured bounds before every call but the first", async (t) =>
  inTemp(async (dir) => {
    const delays = recordDelays(t);
    await runBenchmark({
      ...runInput(dir, { minRequestDelayMs: 7, maxRequestDelayMs: 7 }),
      completion: scripted(success()),
    });
    assert.deepEqual(delays, [7, 7]);
  }));
