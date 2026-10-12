import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadDataset, modelInput } from "../lib/dataset.mjs";
import { validateModel } from "../lib/model-validation.mjs";
import { openPlugin } from "../lib/plugin.mjs";
import { readJSON, readJSONL } from "../lib/util.mjs";
import { benchmark, fails, inScratch, repo, succeeds } from "./cli-harness.mjs";

const adapter = await openPlugin(repo, { allowNode: true });
const data = await loadDataset(join(benchmark, "data/cases.jsonl"));
const examples = join(benchmark, "examples");

test("parity prints the plugin source snapshot", async () => {
  assert.equal(
    await succeeds(["parity", "--repo", "../.."], "bun"),
    `${JSON.stringify(adapter.snapshot, null, 2)}\n`,
  );
});

test("render needs models and a new output directory, then writes one request per case and model", async () => {
  await inScratch(async (dir) => {
    const config = JSON.parse(
      await readFile(join(examples, "models.local.example.json"), "utf8"),
    );
    const systemOne = JSON.parse(
      await readFile(join(examples, "models.system-one.example.json"), "utf8"),
    );
    const models = join(dir, "models.json");
    await writeFile(
      models,
      JSON.stringify([...config.models, ...systemOne.models]),
    );
    const out = join(dir, "render");
    const args = [
      "render",
      "--repo",
      "../..",
      "--limit",
      "2",
      "--split",
      "dev",
    ];
    await Promise.all([
      fails([...args, "--out", out], "bun"),
      fails([...args, "--models", models], "bun"),
    ]);
    assert.equal(
      await succeeds([...args, "--models", models, "--out", out], "bun"),
      "4 rendered requests; ZERO network calls and ZERO fixture executions.\n",
    );
    const cases = data.cases.filter((c) => c.split === "dev").slice(0, 2);
    const checked = [...config.models, ...systemOne.models].map(validateModel);
    const pairs = cases.flatMap((c) => checked.map((model) => [c, model]));
    const prepared = await Promise.all(
      pairs.map(([c, model]) => adapter.prepare(modelInput(c), model)),
    );
    const expected = pairs.map(([c, model], i) => ({
      caseId: c.id,
      modelId: model.id,
      reachable: prepared[i].reachable,
      promptHash: prepared[i].promptHash,
      evidenceHash: prepared[i].evidenceHash,
      actionEvidenceComplete: prepared[i].actionEvidenceComplete,
      ...(model.transport === "system-one"
        ? { systemOne: prepared[i].systemOne }
        : {
            system: prepared[i].system,
            user: prepared[i].user,
            schema: prepared[i].schema,
          }),
    }));
    assert.equal(
      await readFile(join(out, "requests.jsonl"), "utf8"),
      `${expected.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
    assert.deepEqual(await readJSON(join(out, "render-manifest.json")), {
      cases: 2,
      models: 2,
      source: adapter.snapshot,
      datasetHash: data.hash,
      promptVersion: adapter.promptVersion,
    });
    assert.equal((await readJSONL(join(out, "requests.jsonl"))).rows.length, 4);
    await fails([...args, "--models", models, "--out", out], "bun");
  });
});
