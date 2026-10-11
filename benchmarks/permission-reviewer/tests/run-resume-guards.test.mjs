import assert from "node:assert/strict";
import { appendFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runBenchmark } from "../lib/run.mjs";
import { exists, readJSONL } from "../lib/util.mjs";
import { success } from "./helpers.mjs";
import {
  attemptsOf,
  eventsOf,
  failure,
  inSequence,
  inTemp,
  keyOf,
  recordDelays,
  rowsOf,
  runInput,
  scripted,
} from "./run-fixtures.mjs";

const jsonl = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");
const run = (dir, options = {}) => ({
  ...runInput(dir, options, 2),
  completion: scripted(success()),
});
const resume = (dir) => runBenchmark(run(dir, { resume: true }));
const reforge = async (dir, name, edit) =>
  writeFile(
    join(dir, name),
    jsonl(edit((await readJSONL(join(dir, name))).rows)),
  );

const reran = async (dir, file, edit) => {
  await runBenchmark(run(dir));
  await reforge(dir, file, edit);
};

/** Each entry arranges the directory, returns the expected message, then acts. */
const guards = [
  [async () => "Cannot resume: run.json is absent.", resume],
  [
    async (dir) => {
      await writeFile(join(dir, "attempts.jsonl"), "");
      return "Orphan result files exist; use another output directory.";
    },
    (dir) => runBenchmark(run(dir)),
  ],
  [
    async (dir) => {
      await runBenchmark(run(dir));
      return "Output directory already contains a run. Use a new directory or explicit --resume.";
    },
    (dir) => runBenchmark(run(dir)),
  ],
  [
    async (dir) => {
      await runBenchmark(run(dir));
      return "Resume fingerprint mismatch: dataset, labels, sources, profiles or settings changed.";
    },
    (dir) => runBenchmark(run(dir, { resume: true, seed: 3 })),
  ],
  [
    async (dir) => {
      await reran(dir, "results.jsonl", (rows) =>
        rows.map((r) => ({ ...r, runFingerprint: "other" })),
      );
      return "Unexpected row fingerprint.";
    },
    resume,
  ],
  [
    async (dir) => {
      await reran(dir, "results.jsonl", (rows) => [...rows, rows[0]]);
      return `Duplicate completed result: ${keyOf((await rowsOf(dir))[0])}`;
    },
    resume,
  ],
  [
    async (dir) => {
      await reran(dir, "events.jsonl", () => []);
      return "Attempt journal is inconsistent with started HTTP calls.";
    },
    resume,
  ],
  [
    async (dir) => {
      await reran(dir, "attempts.jsonl", (rows) =>
        rows.map((a) => ({ ...a, runFingerprint: "other" })),
      );
      return "Unexpected attempt fingerprint.";
    },
    resume,
  ],
];

test("output directory and resume guards keep their exact messages and release the lock", async () =>
  inSequence(guards, ([arrange, act]) =>
    inTemp(async (dir) => {
      const message = await arrange(dir);
      await assert.rejects(act(dir), { message });
      assert.equal(await exists(join(dir, ".run.lock")), false, message);
    }),
  ));

test("resume discards a torn final record and keeps a note of its size", async () =>
  inTemp(async (dir) => {
    await runBenchmark(run(dir));
    const [first] = await rowsOf(dir);
    await writeFile(join(dir, "results.jsonl"), jsonl([first]));
    await appendFile(join(dir, "results.jsonl"), '{"caseId":"torn');
    const summary = await resume(dir);
    assert(summary.complete);
    const note = join(dir, "results.jsonl.recovered-tail.txt");
    assert.equal(
      await readFile(note, "utf8"),
      "A final incomplete JSONL record was discarded during explicit resume. Bytes: 15\n",
    );
    assert.equal((await stat(note)).mode & 0o777, 0o600);
    assert.equal((await rowsOf(dir)).length, 2);
  }));

test("resume replays journaled retries without backoff until the last saved attempt", async (t) =>
  inTemp(async (dir) => {
    const delays = recordDelays(t);
    const completion = scripted(failure(503), success());
    const retrying = { ...runInput(dir, { httpRetries: 1 }, 1), completion };
    await runBenchmark(retrying);
    assert.deepEqual(delays, [500]);
    await writeFile(join(dir, "results.jsonl"), "");
    await runBenchmark({
      ...retrying,
      options: { ...retrying.options, resume: true },
    });
    assert.equal(completion.requests.length, 2);
    assert.deepEqual(delays, [500]);

    await writeFile(join(dir, "results.jsonl"), "");
    await reforge(dir, "attempts.jsonl", (rows) => rows.slice(0, 1));
    await reforge(dir, "events.jsonl", (rows) => {
      const second = rows.findLast((e) => e.event === "http-start");
      return rows.filter((e) => e !== second);
    });
    const summary = await runBenchmark({
      ...retrying,
      options: { ...retrying.options, resume: true },
    });
    assert.equal(completion.requests.length, 3);
    assert.deepEqual(delays, [500, 500]);
    assert.equal(summary.httpAttemptsTotal, 2);
    const [row] = await rowsOf(dir);
    assert.equal(row.status, "valid");
    assert.deepEqual(
      (await attemptsOf(dir)).map((a) => a.ordinal),
      [1, 2],
    );
    assert.deepEqual(
      (await eventsOf(dir))
        .filter((e) => e.event === "http-start")
        .map((e) => e.ordinal),
      [1, 2],
    );
  }));

test("resume treats missing journal files as empty", async () =>
  inTemp(async (dir) => {
    await runBenchmark(run(dir));
    await rm(join(dir, "attempts.jsonl"));
    await rm(join(dir, "events.jsonl"));
    const summary = await resume(dir);
    assert(summary.complete);
    assert.equal(summary.httpAttemptsTotal, 0);
    assert.equal((await rowsOf(dir)).length, 2);
  }));
