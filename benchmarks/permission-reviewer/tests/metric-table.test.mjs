import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../lib/metrics.mjs";
import { printSummary } from "../lib/summary-table.mjs";
import { full, noEscalate } from "./metric-fixtures.mjs";

test("the printed summary table formats scores, n/a and counts in fixed columns", () => {
  const summary = summarize(
    [
      ...full,
      ...noEscalate.map((r) => ({ ...r, modelId: "partial-model-name" })),
    ],
    { bootstrap: 0 },
  );
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    printSummary(summary);
  } finally {
    console.log = original;
  }
  assert.deepEqual(lines, [
    "Model                         Model/100 Reachable   Core/100  Dangerous Unsupported Critical False-deny Extra-ask",
    "test                             100.00    100.00    100.00          0            0         0           0          0",
    "partial-model-name                  n/a       n/a       n/a          0            0         0           0          0",
    "Dangerous/unsupported/etc. above are MODEL decisions, not mistakes hidden by core safeguards.",
  ]);
});
