#!/usr/bin/env bun
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CASE_COMMANDS, selection } from "./lib/cli-cases.mjs";
import { parseOptions } from "./lib/cli-options.mjs";
import { PLUGIN_COMMANDS, pluginCommand } from "./lib/cli-replay.mjs";
import { REPORT_COMMANDS } from "./lib/cli-reports.mjs";
import { assert, numberArg } from "./lib/util.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HELP = new Set(["help", "--help", "-h"]);
const USAGE = `PRB-600: permission model benchmark, audited source/core replay.\n\nCommands:\n  node cli.mjs validate\n  node cli.mjs baseline --out runs/smoke [--oracle]\n  bun cli.mjs render --repo /path/plugin --models models.local.json --out runs/render\n  bun cli.mjs run --repo /path/plugin --models models.local.json --out runs/comparison\n  node cli.mjs score --run runs/comparison\n  node cli.mjs audit --run runs/comparison --out reviews/manual.jsonl\n  node cli.mjs compare --left RUN --left-model ID --right RUN --right-model ID\n  node cli.mjs export-public --run runs/comparison --out reviews/public.json\n\nrun: --split all|dev|validation|holdout, --category NAME, --id ID, --limit N,\n     --repeats 1, --concurrency 2, --seed 17, --max-calls 1200,\n     --min-request-delay-ms 0, --max-request-delay-ms 0,\n     --timeout-ms 120000, --http-retries 1, --format-retries 1,\n     --track reviewer|system, --bootstrap 500, --difficult-from SYSTEM_ONE_RUN,\n     --resume, --allow-drift\nAll fixture commands are inert data. Requests go only to configured provider or local OpenCode host URLs.\nLive evaluation requires Bun and the plugin checkout.\nbaseline is a metric-only test, NOT model performance or host integration.\n`;
async function main() {
  const command = process.argv[2] ?? "help";
  if (HELP.has(command)) {
    console.log(USAGE);
    return;
  }
  const a = parseOptions(process.argv.slice(3)),
    seed = numberArg(a.seed, 17, 0, 2147483647, "seed"),
    bootstrap = numberArg(a.bootstrap, 500, 0, 10000, "bootstrap");
  const report = REPORT_COMMANDS.get(command);
  if (report) return report(a, { bootstrap, seed });
  const selected = await selection(command, a, ROOT);
  const caseCommand = CASE_COMMANDS.get(command);
  if (caseCommand)
    return caseCommand(a, { ...selected, bootstrap, seed, root: ROOT });
  assert(PLUGIN_COMMANDS.has(command), `Unknown command: ${command}`);
  return pluginCommand(command, a, { ...selected, bootstrap, seed });
}
main().catch(() => {
  console.error(
    "ERROR: benchmark command failed; check configuration and private run files.",
  );
  process.exitCode = 1;
});
