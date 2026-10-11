import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadDataset } from "../lib/dataset.mjs";
import { openPlugin } from "../lib/plugin.mjs";
import { systemOneDifficultSubset } from "../lib/subsets.mjs";
import { readJSON } from "../lib/util.mjs";
import { benchmark, cli, fails, inScratch, repo } from "./cli-harness.mjs";
import { modelsFile, noRetries, withProvider } from "./cli-provider.mjs";

const data = await loadDataset(join(benchmark, "data/cases.jsonl"));
const { snapshot } = await openPlugin(repo, { allowNode: true });
/** A complete one-model System One run over the corpus that recommends reasoning for `hard` cases. */
const systemOneRun = (hard) => ({
  run: {
    fingerprint: "s1",
    datasetHash: data.hash,
    source: { sourceSha256: snapshot.sourceSha256 },
    models: [{ id: "jev", transport: "system-one", format: "system_one" }],
    options: { repeats: 1 },
  },
  summary: { complete: true, expectedRows: data.cases.length },
  results: data.cases.map((c) => ({
    caseId: c.id,
    modelId: "jev",
    repeat: 0,
    runFingerprint: "s1",
    runMode: "system-one-core-replay",
    status: "valid",
    systemOneReasoningRecommended: hard.has(c.id),
  })),
});

test("--difficult-from runs only the System One run's hard cases and records their provenance", async () => {
  await withProvider(({ endpoint }) =>
    inScratch(async (dir) => {
      const source = join(dir, "system-one");
      await mkdir(source);
      const hard = new Set([data.cases[3].id, data.cases[9].id]);
      const document = systemOneRun(hard);
      await writeFile(join(source, "results.json"), JSON.stringify(document));
      const models = await modelsFile(dir, endpoint, false);
      const run = ["run", "--repo", "../..", "--models", models, ...noRetries];
      const from = ["--difficult-from", source];
      const out = join(dir, "run");
      const systemOne = join(
        benchmark,
        "examples/models.system-one.example.json",
      );
      await Promise.all([
        fails(
          [
            "render",
            "--repo",
            "../..",
            "--models",
            models,
            ...from,
            "--out",
            out,
          ],
          "bun",
        ),
        fails([...run, ...from, "--out", out, "--limit", "1"], "bun"),
        fails([...run, ...from, "--out", out, "--split", "dev"], "bun"),
        fails([...run, ...from, "--out", out, "--category", "git"], "bun"),
        fails([...run, ...from, "--out", out, "--id", data.cases[3].id], "bun"),
        fails(
          [
            "run",
            "--repo",
            "../..",
            "--models",
            systemOne,
            ...from,
            "--out",
            out,
          ],
          "bun",
        ),
      ]);
      const result = await cli([...run, ...from, "--out", out], "bun");
      assert.equal(result.code, 0);
      const saved = await readJSON(join(out, "results.json"));
      assert.deepEqual(new Set(saved.results.map((r) => r.caseId)), hard);
      assert.deepEqual(
        saved.run.options.difficultSubset,
        systemOneDifficultSubset(document, data.hash, data.cases.length)
          .provenance,
      );
      document.run.source.sourceSha256 = "another-plugin";
      await writeFile(join(source, "results.json"), JSON.stringify(document));
      await fails([...run, ...from, "--out", join(dir, "other")], "bun");
    }),
  );
});
