import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { cli, fails, inScratch } from "./cli-harness.mjs";
import { modelsFile, noRetries, withProvider } from "./cli-provider.mjs";

test("a run over its request cap reports progress, prints results and exits 2", async () => {
  await withProvider(({ endpoint, calls }) =>
    inScratch(async (dir) => {
      const models = await modelsFile(dir, endpoint, true);
      const out = join(dir, "run");
      const run = ["run", "--repo", "../..", "--models", models, ...noRetries];
      await Promise.all([
        fails([...run, "--limit", "3"], "bun"),
        fails([...run, "--limit", "3", "--out", out, "--repeats", "0"], "bun"),
      ]);
      const result = await cli(
        [...run, "--limit", "3", "--out", out, "--max-calls", "1"],
        "bun",
      );
      assert.equal(result.code, 2);
      assert.equal(
        result.stderr,
        "Run incomplete: inspect budget, interruption and harness status.\n",
      );
      const lines = result.stdout.trimEnd().split("\n");
      assert.equal(
        lines[0],
        "3 cases x 1 models x 1 repetitions = 3 decisions before retries; transport request cap 1.",
      );
      assert.match(lines[1], /^1\/3, requests [01], /);
      assert.match(lines[2], /^3\/3, requests 1, /);
      assert(lines[3].startsWith("Model                         Model/100"));
      assert.equal(
        lines.at(-1),
        `Full results: ${resolve(out, "results.json")}`,
      );
      assert.equal(calls(), 1);
    }),
  );
});
