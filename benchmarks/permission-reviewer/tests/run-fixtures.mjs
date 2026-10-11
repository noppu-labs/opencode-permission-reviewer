import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDataset } from "../lib/dataset.mjs";
import { readJSONL } from "../lib/util.mjs";
import { fakeAdapter, model } from "./helpers.mjs";

const data = await loadDataset(
  fileURLToPath(new URL("../data/cases.jsonl", import.meta.url)),
);
export const cases = data.cases.slice(0, 3);

/** A one-worker run with no retries over the first `count` cases. */
export const runInput = (out, options = {}, count = 3) => ({
  cases: cases.slice(0, count),
  datasetHash: data.hash,
  models: [model],
  adapter: fakeAdapter,
  out,
  options: {
    bootstrap: 0,
    concurrency: 1,
    httpRetries: 0,
    formatRetries: 0,
    maxCalls: 10,
    ...options,
  },
});

export async function inTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), "prb-run-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run `fn` over `items` one after another. */
export const inSequence = (items, fn) =>
  items.reduce((done, item) => done.then(() => fn(item)), Promise.resolve());

/** A completion that answers from `answers` in order, repeating the last one, and keeps each request. */
export function scripted(...answers) {
  const requests = [];
  const completion = async (_model, _prepared, request) =>
    answers[Math.min(requests.push(request), answers.length) - 1];
  completion.requests = requests;
  return completion;
}

/** Set environment variables for the duration of `fn`, restoring the previous values. */
export async function withEnv(vars, fn) {
  const previous = Object.entries(vars).map(([k]) => [k, process.env[k]]);
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    previous.forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
}

/** Record every setTimeout delay requested during the test and fire it at once. */
export function recordDelays(t) {
  const delays = [];
  const real = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    delays.push(ms);
    return real(fn, 0, ...args);
  });
  return delays;
}

export const failure = (status, extra = {}) => ({
  ok: false,
  status,
  error: "synthetic failure",
  latencyMs: 1,
  ...extra,
});

export const keyOf = (row) => `${row.modelId}/${row.caseId}/${row.repeat}`;
export const rowsOf = async (dir) =>
  (await readJSONL(join(dir, "results.jsonl"))).rows;
export const eventsOf = async (dir) =>
  (await readJSONL(join(dir, "events.jsonl"))).rows;
export const attemptsOf = async (dir) =>
  (await readJSONL(join(dir, "attempts.jsonl"))).rows;
