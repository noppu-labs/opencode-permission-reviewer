import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { caseDigest } from "./dataset.mjs";
import { protocolFor } from "./run-config.mjs";
import { sha256 } from "./util.mjs";

const HARNESS_VERSION = "0.1.0";
async function harnessHash() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = [
    "cli.mjs",
    ...(await readdir(resolve(root, "lib")))
      .filter((x) => x.endsWith(".mjs"))
      .map((x) => `lib/${x}`),
  ].sort(); // NOSONAR(S2871) orders the reads only; stable() sorts the keys again before hashing
  const texts = await Promise.all(
    files.map((path) => readFile(resolve(root, path), "utf8")),
  );
  return sha256(Object.fromEntries(files.map((p, i) => [p, sha256(texts[i])])));
}
/** Everything that identifies a run; its hash is the resume fingerprint. */
export async function runManifest({
  cases,
  datasetHash,
  adapter,
  cfg,
  safeModels,
}) {
  const semanticConfig = { ...cfg };
  delete semanticConfig.resume;
  delete semanticConfig.bootstrap;
  return {
    schemaVersion: 1,
    harnessVersion: HARNESS_VERSION,
    harnessSha256: await harnessHash(),
    environment: {
      node: process.version,
      bun: process.versions.bun ?? null,
      platform: process.platform,
      arch: process.arch,
    },
    source: adapter.snapshot,
    promptVersion: adapter.promptVersion,
    datasetHash,
    caseIds: cases.map((c) => c.id),
    caseHashes: cases.map(caseDigest),
    models: safeModels,
    options: semanticConfig,
    protocol: protocolFor(safeModels),
  };
}
export function runPaths(directory) {
  return {
    manifestPath: resolve(directory, "run.json"),
    rowsPath: resolve(directory, "results.jsonl"),
    attemptPath: resolve(directory, "attempts.jsonl"),
    eventsPath: resolve(directory, "events.jsonl"),
  };
}
