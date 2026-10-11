import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openPlugin } from "../lib/plugin.mjs";
import { repo } from "./plugin-fixtures.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
async function scratch(check) {
  const dir = await mkdtemp(join(tmpdir(), "prb-plugin-"));
  try {
    await check(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const drift =
  "Inspected plugin files differ from the pinned snapshot. Use the pinned checkout or explicitly pass --allow-drift; differences are recorded.";

test("a stale pinned blob refuses the plugin unless drift is allowed, and is then recorded", async () => {
  await scratch(async (dir) => {
    await cp(join(repo, "src"), join(dir, "src"), { recursive: true });
    await cp(join(repo, "package.json"), join(dir, "package.json"));
    await symlink(join(repo, "node_modules"), join(dir, "node_modules"));
    const pinned = join(dir, "src/redact.ts");
    const expected = git("hash-object", pinned);
    await appendFile(pinned, "\n// drift\n");
    const actual = git("hash-object", pinned);
    await assert.rejects(openPlugin(dir, { allowNode: true }), {
      message: drift,
    });
    const drifted = await openPlugin(dir, {
      allowNode: true,
      allowDrift: true,
    });
    assert.equal(drifted.snapshot.match, false);
    assert.equal(drifted.snapshot.pinnedCommit, null);
    assert.deepEqual(drifted.snapshot.inspectedBlobDifferences, [
      { path: "src/redact.ts", expected, actual },
    ]);
  });
});

test("a symlink anywhere under src refuses the snapshot and names its path", async () => {
  await scratch(async (dir) => {
    await mkdir(join(dir, "src/nested"), { recursive: true });
    await writeFile(join(dir, "src/a.ts"), "export {};\n");
    await symlink(join(dir, "src/a.ts"), join(dir, "src/nested/link.ts"));
    await assert.rejects(openPlugin(dir, { allowNode: true }), {
      message:
        "Source symlink is not supported for a reproducible snapshot: nested/link.ts",
    });
  });
});

test("the plugin needs a checkout path, and Bun unless Node is allowed", async () => {
  await assert.rejects(openPlugin(undefined, { allowNode: true }), {
    message: "Provide --repo pointing to your checked-out plugin.",
  });
  if (!process.versions.bun)
    await assert.rejects(openPlugin(repo), {
      message:
        "Use Bun for real plugin imports: bun cli.mjs run ... . Node is supported for offline tests/baselines.",
    });
});
