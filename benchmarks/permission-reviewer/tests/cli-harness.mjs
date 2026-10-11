import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJSONL } from "../lib/util.mjs";

export const benchmark = fileURLToPath(new URL("../", import.meta.url));
export const repo = fileURLToPath(new URL("../../../", import.meta.url));
const FAILED =
  "ERROR: benchmark command failed; check configuration and private run files.\n";

/** Run the CLI and resolve with its exit code and output, failed or not. */
export const cli = (args, runtime = "node") =>
  new Promise((resolve) => {
    execFile(
      runtime,
      ["cli.mjs", ...args],
      { cwd: benchmark, timeout: 120_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stdout, stderr }),
    );
  });
/** The CLI exits 1 with only the generic message; it prints `stdout` (default nothing) first. */
export async function fails(args, runtime = "node", stdout = "") {
  const result = await cli(args, runtime);
  assert.deepEqual(result, { code: 1, stdout, stderr: FAILED });
}
export async function succeeds(args, runtime = "node") {
  const result = await cli(args, runtime);
  assert.equal(result.stderr, "");
  assert.equal(result.code, 0);
  return result.stdout;
}
export async function inScratch(check) {
  const dir = await mkdtemp(join(tmpdir(), "prb-cli-"));
  try {
    return await check(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
/** A small oracle baseline run in `dir`, and its rows. */
export async function baselineRun(dir) {
  const out = join(dir, "run");
  await succeeds([
    "baseline",
    "--oracle",
    "--out",
    out,
    "--split",
    "dev",
    "--limit",
    "6",
    "--bootstrap",
    "0",
  ]);
  return { out, rows: (await readJSONL(join(out, "results.jsonl"))).rows };
}
