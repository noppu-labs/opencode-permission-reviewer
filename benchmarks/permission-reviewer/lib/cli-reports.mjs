import { resolve } from "node:path";
import { exportReview } from "./audit.mjs";
import { compareRows } from "./family-bootstrap.mjs";
import { summarize } from "./metrics.mjs";
import { publicReport } from "./publication.mjs";
import { printSummary } from "./summary-table.mjs";
import {
  assert,
  atomicJSON,
  exists,
  numberArg,
  readJSON,
  readJSONL,
} from "./util.mjs";

async function rowsAt(path) {
  assert(path, "Specify the run path.");
  const resolved = resolve(path);
  if (path.endsWith(".jsonl")) return (await readJSONL(resolved)).rows;
  if (path.endsWith(".json")) {
    const x = await readJSON(resolved);
    return x.results ?? x;
  }
  return (await readJSONL(resolve(resolved, "results.jsonl"))).rows;
}
async function exportPublic(a) {
  assert(a.run && a.out, "Specify --run RUN and --out FILE.");
  assert(
    !(await exists(resolve(a.out))),
    "Public export already exists; choose a new path.",
  );
  const report = publicReport(await readJSON(resolve(a.run, "results.json")));
  await atomicJSON(resolve(a.out), report);
  console.log(
    `Synthetic public report: ${resolve(a.out)} (${report.results.length} cases). Review it before publication.`,
  );
}
async function score(a, { bootstrap, seed }) {
  const rows = await rowsAt(a.run),
    s = summarize(rows, { bootstrap, seed });
  printSummary(s);
  if (a.out) await atomicJSON(resolve(a.out), s);
}
async function audit(a, { seed }) {
  assert(a.out, "Specify --out reviews/file.jsonl");
  console.log(
    await exportReview(await rowsAt(a.run), resolve(a.out), {
      sample: numberArg(a.sample, 30, 0, 100000, "sample"),
      seed,
      all: !!a.all,
    }),
  );
}
const onlyModel = (rows, id) =>
  id ? rows.filter((r) => r.modelId === id) : rows;
/** True unless both sides share one profile, plugin source and run mode, i.e. the comparison is not controlled. */
const incompatibleSides = (left, right) =>
  new Set(left.map((r) => r.profile)).size !== 1 ||
  new Set(right.map((r) => r.profile)).size !== 1 ||
  left[0].profile !== right[0].profile ||
  left[0].pluginSourceSha256 !== right[0].pluginSourceSha256 ||
  left[0].runMode !== right[0].runMode;
async function compare(a, { bootstrap, seed }) {
  const left = onlyModel(await rowsAt(a.left), a["left-model"]),
    right = onlyModel(await rowsAt(a.right), a["right-model"]);
  assert(left.length && right.length, "Selected model has no rows.");
  const incompatible = incompatibleSides(left, right);
  assert(
    !incompatible || a["allow-profile-diff"],
    "Profiles, source or run modes differ. Explicit --allow-profile-diff is needed for a descriptive, not controlled, comparison.",
  );
  const result = {
    ...compareRows(left, right, {
      layer: a.layer ?? "model",
      iterations: bootstrap || 500,
      seed,
    }),
    controlledProfileComparison: !incompatible,
  };
  console.log(JSON.stringify(result, null, 2));
  if (a.out) await atomicJSON(resolve(a.out), result);
}
/** Commands that read an existing run rather than the corpus. */
export const REPORT_COMMANDS = new Map([
  ["export-public", exportPublic],
  ["score", score],
  ["audit", audit],
  ["compare", compare],
]);
