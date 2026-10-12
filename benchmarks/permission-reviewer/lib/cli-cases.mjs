import { resolve } from "node:path";
import { baseline } from "./cli-baseline.mjs";
import { loadDataset, selectCases } from "./dataset.mjs";
import { systemOneDifficultSubset } from "./subsets.mjs";
import { assert, numberArg, readJSON } from "./util.mjs";

async function difficultFrom(command, a, data) {
  assert(command === "run", "--difficult-from is supported only by run.");
  assert(
    a.split === undefined &&
      a.category === undefined &&
      a.id === undefined &&
      a.limit === undefined,
    "--difficult-from already defines the complete subset; do not combine filters.",
  );
  return systemOneDifficultSubset(
    await readJSON(resolve(a["difficult-from"], "results.json")),
    data.hash,
    data.cases.length,
  );
}
/** The corpus (`--data` or the kit's own) and the cases the filters or `--difficult-from` select. */
export async function selection(command, a, root) {
  const data = await loadDataset(
    resolve(a.data ?? resolve(root, "data/cases.jsonl")),
  );
  const difficultSubset =
    a["difficult-from"] === undefined
      ? undefined
      : await difficultFrom(command, a, data);
  const limit =
    a.limit === undefined
      ? undefined
      : numberArg(a.limit, 1, 1, data.cases.length, "limit");
  const cases = selectCases(data.cases, {
    split: a.split ?? "all",
    category: a.category,
    id: a.id,
    ids: difficultSubset?.ids,
    limit,
  });
  return { data, difficultSubset, cases };
}
async function validate(a, { data, cases, root }) {
  const manifest = await readJSON(resolve(root, "data/manifest.json"));
  if (!a.data)
    assert(
      manifest.sha256 === data.hash,
      "Materialized corpus digest differs from manifest; rebuild and review changes.",
    );
  console.log(
    JSON.stringify(
      {
        ...data.validation,
        selected: cases.length,
        sha256: data.hash,
        source: "synthetic, labels pending independent adjudication",
        fixtureExecution: false,
      },
      null,
      2,
    ),
  );
}
/** Commands that need only the selected cases, never the plugin. */
export const CASE_COMMANDS = new Map([
  ["validate", validate],
  ["baseline", baseline],
]);
