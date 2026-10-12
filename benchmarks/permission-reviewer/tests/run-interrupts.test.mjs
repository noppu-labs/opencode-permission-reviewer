import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runBenchmark } from "../lib/run.mjs";
import { readJSON } from "../lib/util.mjs";
import { fakeAdapter, success } from "./helpers.mjs";
import {
  eventsOf,
  failure,
  inSequence,
  inTemp,
  keyOf,
  rowsOf,
  runInput,
  scripted,
} from "./run-fixtures.mjs";

const defects = [
  [new Error("synthetic prepare defect"), "synthetic prepare defect"],
  ["synthetic plain throw", "synthetic plain throw"],
];

test("a harness defect stops the run, keeps finished rows and names every failure", async () =>
  inSequence(defects, ([thrown, reason]) =>
    inTemp(async (dir) => {
      // The first job prepares normally; the second one throws.
      const prepares = [
        fakeAdapter.prepare,
        async () => {
          throw thrown;
        },
      ];
      let prepared = 0;
      await assert.rejects(
        runBenchmark({
          ...runInput(dir),
          adapter: {
            ...fakeAdapter,
            prepare: (input, m) => prepares[prepared++](input, m),
          },
          completion: scripted(success()),
        }),
        {
          message: `Harness failure: ${reason}. Completed records are preserved.`,
        },
      );
      const summary = await readJSON(join(dir, "summary.json"));
      assert.deepEqual(summary.harnessErrors, [reason]);
      assert.equal(summary.complete, false);
      assert.equal(summary.interrupted, true);
      assert.equal((await rowsOf(dir)).length, 1);
      assert.equal((await eventsOf(dir)).at(-1).event, "run-end");
    }),
  ));

test("a safety stop interrupts another worker waiting to retry", async () =>
  inTemp(async (dir) => {
    const completion = scripted(failure(503), failure(429, { halt: true }));
    const summary = await runBenchmark({
      ...runInput(dir, { concurrency: 2, httpRetries: 1 }, 2),
      completion,
    });
    assert.equal(completion.requests.length, 2);
    assert.equal(summary.interrupted, true);
    assert.equal(summary.complete, false);
    const rows = await rowsOf(dir);
    assert.deepEqual(rows.map((r) => r.status).sort(), [
      "interrupted",
      "transport-error",
    ]);
    const waiting = rows.find((r) => r.status === "interrupted");
    assert.equal(waiting.attempts.length, 1);
    assert.equal(waiting.decision, null);
  }));

test("an interrupt during the request delay ends the job before it calls the provider", async () =>
  inTemp(async (dir) => {
    const listeners = process.listenerCount("SIGINT");
    const answer = scripted(success());
    const summary = await runBenchmark({
      ...runInput(dir, { minRequestDelayMs: 300, maxRequestDelayMs: 300 }),
      completion: async (...request) => {
        setTimeout(process.listeners("SIGINT").at(-1), 50);
        return answer(...request);
      },
    });
    assert.equal(process.listenerCount("SIGINT"), listeners);
    assert.equal(answer.requests.length, 1);
    assert.equal(summary.completedRows, 2);
    const rows = await rowsOf(dir);
    assert.deepEqual(
      rows.map((r) => [r.status, r.attempts.length]),
      [
        ["valid", 1],
        ["interrupted", 0],
      ],
    );
    const events = (await eventsOf(dir)).map((e) => [e.event, e.key]);
    assert.deepEqual(events.slice(1, -1), [
      ["http-start", keyOf(rows[0])],
      ["request-wait", keyOf(rows[1])],
    ]);
  }));
