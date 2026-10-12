import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadDataset, selectCases } from "../lib/dataset.mjs";
import { summarize } from "../lib/metrics.mjs";
import { rowBase } from "../lib/run-rows.mjs";
import { printSummary } from "../lib/summary-table.mjs";
import { readJSON, toJsonl } from "../lib/util.mjs";
import { benchmark, fails, inScratch, succeeds } from "./cli-harness.mjs";

const data = await loadDataset(join(benchmark, "data/cases.jsonl"));
const cases = selectCases(data.cases, { split: "holdout", limit: 5 });
function row(id, c) {
  const label = id.startsWith("gold-oracle")
    ? c.gold.outcome
    : id.replace("always-", "");
  const decision = {
    version: 2,
    outcome: label,
    risk_level: "low",
    user_authorization: "high",
    scope_alignment: "aligned",
    evidence_completeness: "sufficient",
    rationale: "Synthetic metric self-test, NOT a real model response.",
    confidence: 1,
  };
  return {
    ...rowBase(
      c,
      { id, model: "NO_MODEL_CALLS", format: "metric-only" },
      0,
      `offline-${data.hash}`,
    ),
    runMode: "metric-only-baseline",
    status: "valid",
    reachable: true,
    decision,
    firstDecision: decision,
    effective: {
      kind: label,
      reason: "Synthetic identity mapping; production gates NOT applied.",
    },
    attempts: [],
    evidence: "No prompt was sent. This is a scoring self-test only.",
  };
}
function printed(summary) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    printSummary(summary);
  } finally {
    console.log = original;
  }
  return lines.map((line) => `${line}\n`).join("");
}

test("baseline writes constant and oracle rows, a labelled summary, and refuses to overwrite", async () => {
  await inScratch(async (dir) => {
    const filters = ["--split", "holdout", "--limit", "5"];
    await fails(["baseline", ...filters]);
    const variants = [
      ["plain", [], ["always-allow", "always-deny", "always-escalate"]],
      [
        "oracle",
        ["--oracle"],
        [
          "always-allow",
          "always-deny",
          "always-escalate",
          "gold-oracle-SELF-TEST",
        ],
      ],
    ];
    const check = async ([name, extra, ids]) => {
      const out = join(dir, name);
      const args = ["baseline", ...filters, "--out", out, ...extra];
      const stdout = await succeeds([
        ...args,
        "--bootstrap",
        "6",
        "--seed",
        "4",
      ]);
      const rows = ids.flatMap((id) => cases.map((c) => row(id, c)));
      const results = join(out, "results.jsonl");
      assert.equal(await readFile(results, "utf8"), toJsonl(rows));
      assert.equal((await stat(results)).mode & 0o777, 0o600);
      assert.equal((await stat(out)).mode & 0o777, 0o700);
      const summary = {
        ...summarize(rows, { bootstrap: 6, seed: 4 }),
        liveModelCalls: 0,
        warning:
          "SYNTHETIC BASELINES ONLY. Gold oracle deliberately reads labels to self-test the metric. Never a model ranking.",
      };
      const saved = await readJSON(join(out, "summary.json"));
      assert.deepEqual(Object.keys(saved), Object.keys(summary));
      assert.deepEqual(
        { ...saved, generatedAt: "<ts>" },
        { ...summary, generatedAt: "<ts>" },
      );
      assert.equal(stdout, printed(saved));
      await fails(args);
    };
    await Promise.all(variants.map(check));
  });
});
