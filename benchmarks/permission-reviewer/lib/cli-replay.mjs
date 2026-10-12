import { resolve } from "node:path";
import { render } from "./cli-render.mjs";
import { validateModel } from "./model-validation.mjs";
import { openPlugin } from "./plugin.mjs";
import { runBenchmark } from "./run.mjs";
import { printSummary } from "./summary-table.mjs";
import { assert, numberArg, readJSON } from "./util.mjs";

async function selectedModels(a, difficultSubset) {
  assert(
    a.models,
    "Specify --models examples/models.local.example.json (copy and edit first).",
  );
  const config = await readJSON(resolve(a.models));
  const models = (Array.isArray(config) ? config : config.models).map(
    validateModel,
  );
  if (difficultSubset)
    assert(
      models.every((model) => model.transport !== "system-one"),
      "--difficult-from is for follow-up reasoning models, not another System One run.",
    );
  return models;
}
const runOptions = (a, { repeats, seed, bootstrap, difficultSubset }) => ({
  repeats,
  concurrency: numberArg(a.concurrency, 2, 1, 32, "concurrency"),
  seed,
  track: a.track ?? "reviewer",
  maxCalls: numberArg(a["max-calls"], 1200, 1, 1000000, "max-calls"),
  minRequestDelayMs: numberArg(
    a["min-request-delay-ms"],
    0,
    0,
    60000,
    "min-request-delay-ms",
  ),
  maxRequestDelayMs: numberArg(
    a["max-request-delay-ms"],
    0,
    0,
    60000,
    "max-request-delay-ms",
  ),
  timeoutMs: numberArg(a["timeout-ms"], 120000, 100, 1800000, "timeout-ms"),
  httpRetries: numberArg(a["http-retries"], 1, 0, 3, "http-retries"),
  formatRetries: numberArg(a["format-retries"], 1, 0, 2, "format-retries"),
  bootstrap,
  resume: !!a.resume,
  storePrompts: !a["no-prompts"],
  ...(difficultSubset ? { difficultSubset: difficultSubset.provenance } : {}),
});
async function run(a, { adapter, models, cases, data, ...settings }) {
  const repeats = numberArg(a.repeats, 1, 1, 100, "repeats"),
    total = cases.length * models.length * repeats;
  const options = runOptions(a, { repeats, ...settings });
  console.log(
    `${cases.length} cases x ${models.length} models x ${repeats} repetitions = ${total} decisions before retries; transport request cap ${options.maxCalls}.`,
  );
  let last = 0;
  const summary = await runBenchmark({
    cases,
    datasetHash: data.hash,
    models,
    adapter,
    out: a.out,
    options,
    onProgress: (p) => {
      if (p.finished === p.total || Date.now() - last > 3000) {
        console.log(
          `${p.finished}/${p.total}, requests ${p.calls}, ${p.status}`,
        );
        last = Date.now();
      }
    },
  });
  printSummary(summary);
  console.log(`Full results: ${resolve(a.out, "results.json")}`);
  if (!summary.complete) {
    console.error(
      "Run incomplete: inspect budget, interruption and harness status.",
    );
    process.exitCode = 2;
  }
}
/** Commands that open the plugin checkout; each needs Bun. */
export const PLUGIN_COMMANDS = new Set(["run", "render", "parity"]);
/** Open the plugin, then print its snapshot (parity), render the requests, or run the models. */
export async function pluginCommand(command, a, context) {
  const { difficultSubset } = context;
  const adapter = await openPlugin(a.repo, { allowDrift: !!a["allow-drift"] });
  if (difficultSubset)
    assert(
      difficultSubset.provenance.sourcePluginSha256 ===
        adapter.snapshot.sourceSha256,
      "Difficult-subset source used a different plugin source.",
    );
  if (command === "parity") {
    console.log(JSON.stringify(adapter.snapshot, null, 2));
    return;
  }
  const models = await selectedModels(a, difficultSubset);
  assert(a.out, "Specify a new output directory via --out.");
  const next = command === "render" ? render : run;
  await next(a, { ...context, adapter, models });
}
