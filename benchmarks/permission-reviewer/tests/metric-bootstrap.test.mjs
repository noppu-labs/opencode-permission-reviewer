import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapScore, compareRows } from "../lib/metrics.mjs";
import { decision } from "./helpers.mjs";
import { full, noEscalate } from "./metric-fixtures.mjs";

test("bootstrap returns null for one family, zero iterations or no scorable resample", () => {
  assert.equal(bootstrapScore(full.slice(0, 3), "model"), null);
  assert.equal(bootstrapScore(full, "model", { iterations: 0 }), null);
  assert.equal(bootstrapScore(noEscalate, "model", { iterations: 5 }), null);
  assert.deepEqual(
    Object.keys(bootstrapScore(full, "effective", { iterations: 3, seed: 2 })),
    [
      "method",
      "iterations",
      "validResamples",
      "seed",
      "low",
      "high",
      "confidence",
      "warning",
    ],
  );
});

test("comparison checks the layer, duplicates and scorability, in that order", () => {
  assert.throws(() => compareRows(full, full, { layer: "gated" }), {
    message: "Comparison layer must be model or effective.",
  });
  assert.throws(() => compareRows([...full, full[0]], full), {
    message:
      "Compare expects exactly one model on each side and no duplicate attempts.",
  });
  const result = compareRows(noEscalate, noEscalate, { iterations: 4 });
  assert.equal(
    JSON.stringify(result),
    JSON.stringify({
      layer: "model",
      leftModel: "test",
      rightModel: "test",
      deltaRightMinusLeft: null,
      ci95: { low: null, high: null },
      iterations: 4,
      validResamples: 0,
      method:
        "paired cluster bootstrap by semantic family; shared repeat indices",
      warning:
        "Inspect safety counts before choosing by score. A CI crossing zero does not establish a winner.",
    }),
  );
});

test("comparison resamples families with the seeded generator", () => {
  const right = full.map((r) =>
    r.family === "f2" && r.gold.outcome === "deny"
      ? { ...r, decision: decision("allow"), effective: { kind: "allow" } }
      : r,
  );
  const result = compareRows(full, right, {
    layer: "effective",
    iterations: 20,
    seed: 5,
  });
  assert.deepEqual(
    result,
    compareRows(full, right, { layer: "effective", iterations: 20, seed: 5 }),
  );
  assert(result.deltaRightMinusLeft < 0);
  assert.equal(result.validResamples, 20);
  assert(result.ci95.low <= result.ci95.high);
});
