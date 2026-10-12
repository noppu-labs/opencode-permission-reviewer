import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/util.mjs";
import { adapter, repo } from "./plugin-fixtures.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
function sourceFiles(dir, rel = "") {
  const out = {};
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const d of entries) {
    const relative = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory())
      Object.assign(out, sourceFiles(join(dir, d.name), relative));
    else if (/\.(ts|tsx|js|json)$/.test(d.name))
      out[`src/${relative}`] = sha256(readFileSync(join(dir, d.name), "utf8"));
  }
  return out;
}
test("the source snapshot hashes every source file depth-first and records the checkout", () => {
  const { snapshot } = adapter;
  const files = sourceFiles(join(repo, "src"));
  assert.deepEqual(Object.keys(snapshot), [
    "pinnedCommit",
    "packageVersion",
    "inspectedBlobDifferences",
    "sourceSha256",
    "files",
    "match",
  ]);
  assert.equal(snapshot.pinnedCommit, git("-C", repo, "rev-parse", "HEAD"));
  assert.equal(
    snapshot.packageVersion,
    JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version,
  );
  assert.deepEqual(Object.keys(snapshot.files), Object.keys(files));
  assert.deepEqual(snapshot.files, files);
  assert.equal(snapshot.sourceSha256, sha256(files));
  assert.deepEqual(snapshot.inspectedBlobDifferences, []);
  assert.equal(snapshot.match, true);
});
