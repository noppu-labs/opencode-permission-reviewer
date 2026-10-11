import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { compareRows } from "../lib/family-bootstrap.mjs";
import { publicReport } from "../lib/publication.mjs";
import { toJsonl } from "../lib/util.mjs";
import { baselineRun, fails, inScratch, succeeds } from "./cli-harness.mjs";

const pick = (rows, id) => rows.filter((r) => r.modelId === id);

test("compare pairs one model per side and prints and saves the paired result", async () => {
  await inScratch(async (dir) => {
    const { out, rows } = await baselineRun(dir);
    const sides = [
      "--left",
      out,
      "--left-model",
      "always-allow",
      "--right",
      out,
      "--right-model",
      "gold-oracle-SELF-TEST",
    ];
    const saved = join(dir, "compare.json");
    const stdout = await succeeds([
      "compare",
      ...sides,
      "--bootstrap",
      "4",
      "--seed",
      "9",
      "--layer",
      "effective",
      "--out",
      saved,
    ]);
    const expected = {
      ...compareRows(
        pick(rows, "always-allow"),
        pick(rows, "gold-oracle-SELF-TEST"),
        { layer: "effective", iterations: 4, seed: 9 },
      ),
      controlledProfileComparison: true,
    };
    assert.equal(stdout, `${JSON.stringify(expected, null, 2)}\n`);
    assert.equal(await readFile(saved, "utf8"), stdout);
    const fallback = JSON.parse(
      await succeeds(["compare", ...sides, "--bootstrap", "0"]),
    );
    assert.equal(fallback.layer, "model");
    assert.equal(fallback.iterations, 500);
    await Promise.all([
      fails(["compare", ...sides, "--layer", "gated"]),
      fails(["compare", "--left", out, "--right", out]),
      fails([
        "compare",
        ...sides.slice(0, 4),
        "--right",
        out,
        "--right-model",
        "missing",
      ]),
    ]);
  });
});

test("compare refuses mixed profiles, plugin sources or run modes unless explicitly allowed", async () => {
  await inScratch(async (dir) => {
    const { out, rows } = await baselineRun(dir);
    const right = pick(rows, "gold-oracle-SELF-TEST");
    const variants = [
      right.map((r) => ({ ...r, profile: "text" })),
      right.map((r, i) => (i ? r : { ...r, profile: "text" })),
      right.map((r) => ({ ...r, pluginSourceSha256: "other" })),
      right.map((r) => ({ ...r, runMode: "live-provider-core-replay" })),
    ];
    await Promise.all(
      variants.map(async (variant, i) => {
        const path = join(dir, `right-${i}.jsonl`);
        await writeFile(path, toJsonl(variant));
        const args = [
          "compare",
          "--left",
          out,
          "--left-model",
          "always-allow",
          "--right",
          path,
        ];
        await fails(args);
        const result = JSON.parse(
          await succeeds([...args, "--allow-profile-diff", "--bootstrap", "2"]),
        );
        assert.equal(result.controlledProfileComparison, false);
      }),
    );
  });
});

test("export-public needs --run and --out, never overwrites, and writes the public report", async () => {
  await inScratch(async (dir) => {
    const run = join(dir, "run");
    await mkdir(run);
    const document = {
      run: {
        fingerprint: "run-hash",
        datasetHash: "corpus-hash",
        source: { match: true, sourceSha256: "source-hash" },
        models: [{ id: "candidate", model: "candidate-version" }],
      },
      summary: { complete: true, expectedRows: 1, models: { candidate: {} } },
      results: [{ origin: "authored-synthetic", runFingerprint: "run-hash" }],
    };
    await writeFile(join(run, "results.json"), JSON.stringify(document));
    const out = join(dir, "public.json");
    await Promise.all([
      fails(["export-public", "--run", run]),
      fails(["export-public", "--out", out]),
    ]);
    assert.equal(
      await succeeds(["export-public", "--run", run, "--out", out]),
      `Synthetic public report: ${resolve(out)} (1 cases). Review it before publication.\n`,
    );
    assert.equal(
      await readFile(out, "utf8"),
      `${JSON.stringify(publicReport(document), null, 2)}\n`,
    );
    await fails(["export-public", "--run", run, "--out", out]);
  });
});
