import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { baselineRow } from "./baseline-rows.mjs";
import { summarize } from "./metrics.mjs";
import { printSummary } from "./summary-table.mjs";
import { assert, atomicJSON, exists, privateDir, toJsonl } from "./util.mjs";

/** Write the constant (and with --oracle, gold) decisions for the selected cases and score them. */
export async function baseline(a, { data, cases, bootstrap, seed }) {
  assert(a.out, "Specify --out runs/smoke");
  assert(
    !(await exists(resolve(a.out, "results.jsonl"))),
    "Baseline output already exists.",
  );
  const choices = [
    "always-allow",
    "always-deny",
    "always-escalate",
    ...(a.oracle ? ["gold-oracle-SELF-TEST"] : []),
  ];
  const rows = choices.flatMap((id) =>
    cases.map((c) => baselineRow(id, c, data.hash)),
  );
  await privateDir(resolve(a.out));
  await writeFile(resolve(a.out, "results.jsonl"), toJsonl(rows), {
    mode: 0o600,
  });
  const summary = summarize(rows, { bootstrap, seed });
  summary.liveModelCalls = 0;
  summary.warning =
    "SYNTHETIC BASELINES ONLY. Gold oracle deliberately reads labels to self-test the metric. Never a model ranking.";
  await atomicJSON(resolve(a.out, "summary.json"), summary);
  printSummary(summary);
}
