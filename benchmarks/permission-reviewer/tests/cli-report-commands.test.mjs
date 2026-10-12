import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { inspect } from "node:util";
import { exportReview } from "../lib/audit.mjs";
import { summarize } from "../lib/metrics.mjs";
import { readJSON, readJSONL } from "../lib/util.mjs";
import { baselineRun, fails, inScratch, succeeds } from "./cli-harness.mjs";

const undated = (summary) => ({ ...summary, generatedAt: "<ts>" });

test("score reads a run directory, its JSONL, or a JSON document and saves the summary on request", async () => {
  await inScratch(async (dir) => {
    const { out, rows } = await baselineRun(dir);
    const saved = join(dir, "score.json");
    const args = ["--bootstrap", "7", "--seed", "3"];
    const table = await succeeds([
      "score",
      "--run",
      out,
      "--out",
      saved,
      ...args,
    ]);
    assert(table.startsWith("Model                         Model/100"));
    assert.deepEqual(
      undated(await readJSON(saved)),
      undated(summarize(rows, { bootstrap: 7, seed: 3 })),
    );
    const wrapped = join(dir, "wrapped.json");
    const bare = join(dir, "bare.json");
    await writeFile(wrapped, JSON.stringify({ results: rows }));
    await writeFile(bare, JSON.stringify(rows));
    const tables = await Promise.all(
      [join(out, "results.jsonl"), wrapped, bare].map((run) =>
        succeeds(["score", "--run", run, ...args]),
      ),
    );
    assert.deepEqual(tables, [table, table, table]);
    await fails(["score"]);
  });
});

test("audit needs --out, never overwrites, and samples like exportReview", async () => {
  await inScratch(async (dir) => {
    const { out, rows } = await baselineRun(dir);
    await fails(["audit", "--run", out]);
    const sheet = join(dir, "sheet.jsonl");
    const expected = join(dir, "expected.jsonl");
    const stdout = await succeeds([
      "audit",
      "--run",
      out,
      "--out",
      sheet,
      "--sample",
      "2",
      "--seed",
      "5",
    ]);
    const result = await exportReview(rows, expected, { sample: 2, seed: 5 });
    assert.equal(stdout, `${inspect({ ...result, reviewFile: sheet })}\n`);
    assert.equal(
      await readFile(sheet, "utf8"),
      await readFile(expected, "utf8"),
    );
    await fails(["audit", "--run", out, "--out", sheet]);
    const all = join(dir, "all.jsonl");
    await succeeds(["audit", "--run", out, "--out", all, "--all"]);
    assert.equal((await readJSONL(all)).rows.length, rows.length);
  });
});
