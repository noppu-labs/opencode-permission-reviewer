import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadDataset, selectCases } from "../lib/dataset.mjs";
import { benchmark, fails, inScratch, succeeds } from "./cli-harness.mjs";

const corpus = join(benchmark, "data/cases.jsonl");
const data = await loadDataset(corpus);
const validation = (dataset, cases) =>
  `${JSON.stringify(
    {
      ...dataset.validation,
      selected: cases.length,
      sha256: dataset.hash,
      source: "synthetic, labels pending independent adjudication",
      fixtureExecution: false,
    },
    null,
    2,
  )}\n`;

test("help is the default command, has three aliases and ignores any options", async () => {
  const help = await succeeds([]);
  assert(help.startsWith("PRB-600: permission model benchmark"));
  const aliases = [["help"], ["--help"], ["-h"], ["help", "--bogus"]];
  for (const output of await Promise.all(aliases.map((a) => succeeds(a))))
    assert.equal(output, help);
});

test("options must be known, single, and given a value unless boolean", async () => {
  const invalid = [
    ["validate", "positional"],
    ["validate", "--bogus"],
    ["validate", "--split", "dev", "--split", "dev"],
    ["validate", "--all", "--all"],
    ["validate", "--split"],
    ["validate", "--split", "--all"],
    ["validate", "--seed", "x"],
    ["validate", "--seed", "-1"],
    ["validate", "--seed", "2147483648"],
    ["validate", "--bootstrap", "10001"],
    ["validate", "--limit", "0"],
    ["validate", "--limit", String(data.cases.length + 1)],
    ["validate", "--category", "does-not-exist"],
  ];
  await Promise.all(invalid.map((args) => fails(args)));
  await succeeds([
    "validate",
    "--all",
    "--seed",
    "2147483647",
    "--bootstrap",
    "10000",
  ]);
});

test("validate prints the corpus summary for the selected cases", async () => {
  assert.equal(await succeeds(["validate"]), validation(data, data.cases));
  const filters = { split: "dev", category: "git", limit: 3 };
  assert.equal(
    await succeeds([
      "validate",
      "--split",
      "dev",
      "--category",
      "git",
      "--limit",
      "3",
    ]),
    validation(data, selectCases(data.cases, filters)),
  );
  const id = data.cases[7].id;
  assert.equal(
    await succeeds(["validate", "--id", id]),
    validation(data, [data.cases[7]]),
  );
});

test("an explicit --data corpus skips the manifest digest check", async () => {
  await inScratch(async (dir) => {
    const path = join(dir, "cases.jsonl");
    const lines = (await readFile(corpus, "utf8"))
      .trimEnd()
      .split("\n")
      .filter((line) => !/"(attack|metamorphic)":/.test(line));
    await writeFile(path, `${lines.slice(0, 40).join("\n")}\n`);
    const subset = await loadDataset(path);
    assert.notEqual(subset.hash, data.hash);
    assert.equal(
      await succeeds(["validate", "--data", path]),
      validation(subset, subset.cases),
    );
  });
});

test("unknown commands and Node runs of plugin commands fail after case selection", async () => {
  await Promise.all(
    ["nope", "run", "render", "parity"].map((command) =>
      fails([command, "--repo", "../..", "--out", "never-written"]),
    ),
  );
  await fails(["validate", "--difficult-from", "missing-run"]);
});
