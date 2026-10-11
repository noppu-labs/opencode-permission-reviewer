import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runBenchmark } from "../lib/run.mjs";
import { readJSON } from "../lib/util.mjs";
import { model, success } from "./helpers.mjs";
import {
  attemptsOf,
  cases,
  eventsOf,
  inSequence,
  inTemp,
  rowsOf,
  runInput,
  scripted,
} from "./run-fixtures.mjs";

const HEAD = [
  "schemaVersion",
  "runFingerprint",
  "caseId",
  "caseHash",
  "modelId",
  "model",
  "profile",
  "family",
  "category",
  "split",
  "origin",
  "variant",
  "difficulty",
  "repeat",
  "gold",
  "runMode",
  "pluginSourceSha256",
  "reachable",
  "promptHash",
  "evidenceHash",
  "actionEvidenceComplete",
];
const TAIL = [
  "status",
  "attempts",
  "decision",
  "firstDecision",
  "exposedRationale",
  "systemOneDifficulty",
  "systemOneReasoningRecommended",
  "gated",
  "effective",
  "elapsedMs",
];
const keysByEvent = async (dir) =>
  Object.fromEntries(
    (await eventsOf(dir)).map((e) => [e.event, Object.keys(e)]),
  );

test("rows, events, journal records, manifest and summary keep their key order", async () =>
  inTemp(async (dir) => {
    const progress = [];
    await runBenchmark({
      ...runInput(dir, { minRequestDelayMs: 1, maxRequestDelayMs: 1 }, 2),
      completion: scripted(success()),
      onProgress: (p) => progress.push(p),
    });
    const rows = await rowsOf(dir);
    assert.deepEqual(Object.keys(rows[0]), [
      ...HEAD,
      "prompt",
      "evidence",
      ...TAIL,
    ]);
    assert.deepEqual(await keysByEvent(dir), {
      "run-start": [
        "event",
        "fingerprint",
        "at",
        "resume",
        "remaining",
        "previousHTTPAttempts",
      ],
      "http-start": ["event", "key", "ordinal", "at"],
      "request-wait": ["event", "key", "waitMs", "at"],
      "run-end": ["event", "complete", "at", "completed", "expected"],
    });
    assert.deepEqual(Object.keys((await attemptsOf(dir))[0]), [
      "schemaVersion",
      "runFingerprint",
      "key",
      "ordinal",
      "at",
      "attempt",
    ]);
    const manifest = await readJSON(join(dir, "run.json"));
    assert.deepEqual(Object.keys(manifest), [
      "schemaVersion",
      "harnessVersion",
      "harnessSha256",
      "environment",
      "source",
      "promptVersion",
      "datasetHash",
      "caseIds",
      "caseHashes",
      "models",
      "options",
      "protocol",
      "fingerprint",
      "createdAt",
    ]);
    assert.deepEqual(Object.keys(manifest.options), [
      "repeats",
      "concurrency",
      "seed",
      "track",
      "timeoutMs",
      "maxCalls",
      "minRequestDelayMs",
      "maxRequestDelayMs",
      "httpRetries",
      "formatRetries",
      "storePrompts",
    ]);
    assert.deepEqual(Object.keys(await readJSON(join(dir, "summary.json"))), [
      "generatedAt",
      "rows",
      "models",
      "warning",
      "runFingerprint",
      "complete",
      "expectedRows",
      "completedRows",
      "httpAttemptsTotal",
      "interrupted",
      "harnessErrors",
      "source",
      "modelsConfig",
    ]);
    assert.deepEqual(Object.keys(await readJSON(join(dir, "results.json"))), [
      "run",
      "summary",
      "results",
    ]);
    assert.deepEqual(
      progress.map((p) => [
        Object.keys(p),
        p.finished,
        p.total,
        p.calls,
        p.status,
      ]),
      [
        [["finished", "total", "calls", "last", "status"], 1, 2, 1, "valid"],
        [["finished", "total", "calls", "last", "status"], 2, 2, 2, "valid"],
      ],
    );
    assert.deepEqual(
      progress.map((p) => p.last),
      rows.map((r) => `${r.modelId}/${r.caseId}/${r.repeat}`),
    );
  }));

test("bypassed and prompt-free rows keep their key order", async () =>
  inTemp(async (dir) => {
    const bypassed = structuredClone(cases[0]);
    bypassed.input.preflightDenial = "Fixed test preflight deny";
    await runBenchmark({
      ...runInput(dir, { track: "system", storePrompts: false }),
      cases: [bypassed, cases[1]],
      completion: scripted(success()),
    });
    const rows = await rowsOf(dir);
    const bypass = rows.find((r) => r.status === "bypass");
    const valid = rows.find((r) => r.status === "valid");
    assert.deepEqual(Object.keys(bypass), [
      ...HEAD,
      "evidence",
      "status",
      "attempts",
      "decision",
      "firstDecision",
      "gated",
      "effective",
      "elapsedMs",
    ]);
    assert.deepEqual(bypass.effective, {
      kind: "deny",
      reason: "Fixed test preflight deny",
    });
    assert.deepEqual(Object.keys(valid), [...HEAD, "evidence", ...TAIL]);
  }));

const BASIS =
  "Configured uncached input/output rates, ignoring cache/reasoning/provider-specific price tiers.";

const priced = [
  [
    { input: 2, output: 4 },
    success(),
    { amount: (30 * 2 + 15 * 4) / 1e6, currency: "USD", basis: BASIS },
  ],
  [{ input: 2 }, success(), null],
  [undefined, success(), null],
  [{ input: 2, output: 4 }, { ...success(), usage: undefined }, null],
];

test("estimated cost needs both prices and complete usage", async () =>
  inSequence(priced, ([pricesPerMillion, answer, expected]) =>
    inTemp(async (dir) => {
      const summary = await runBenchmark({
        ...runInput(dir),
        models: [{ ...model, pricesPerMillion }],
        completion: scripted(answer),
      });
      assert.deepEqual(
        summary.models[model.id].operational.estimatedCost,
        expected,
      );
    }),
  ));

test("a model without a format is recorded with the text profile", async () =>
  inTemp(async (dir) => {
    const { format: _format, ...unformatted } = model;
    await runBenchmark({
      ...runInput(dir, {}, 1),
      models: [unformatted],
      completion: scripted(success()),
    });
    assert.equal((await rowsOf(dir))[0].profile, "text");
  }));
