import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "./util.mjs";

const gitBlob = (bytes) =>
  createHash("sha1") // NOSONAR(S4790) SHA-1 is git's blob-object hash, compared against git blob IDs, not used for security
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
async function walk(files, dir, rel = "") {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const d of entries) {
    const relative = rel ? `${rel}/${d.name}` : d.name;
    if (d.isSymbolicLink())
      throw new Error(
        `Source symlink is not supported for a reproducible snapshot: ${relative}`,
      );
    if (d.isDirectory())
      // biome-ignore lint/performance/noAwaitInLoops: the walk must throw at the first symlink before reading any later entry; it also fills the returned files map in sorted depth-first order, which the written snapshot shows (sourceSha256 is key-sorted and does not depend on it)
      await walk(files, join(dir, d.name), relative);
    else if (/\.(ts|tsx|js|json)$/.test(d.name))
      files[`src/${relative}`] = sha256(
        await readFile(join(dir, d.name)).then((b) => b.toString("utf8")),
      );
  }
}
const blobDifferences = async (repo, pinnedBlobs) =>
  (
    await Promise.all(
      Object.entries(pinnedBlobs).map(async ([path, expected]) => ({
        path,
        expected,
        actual: gitBlob(await readFile(resolve(repo, path))),
      })),
    )
  ).filter(({ expected, actual }) => actual !== expected);
function checkedOutCommit(repo) {
  try {
    // The blob map gates source parity; record the checked-out commit for provenance.
    return execFileSync(
      "git", // NOSONAR(S4036) resolved via PATH like every other git call; the commit is provenance only
      ["-C", resolve(repo), "rev-parse", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    // A source copy can still be compared by its file hashes without Git metadata.
    return null;
  }
}
/** Hash every source file under `repo`/src and compare `pinnedBlobs` (path to git blob SHA-1) with the checkout. */
export async function sourceSnapshot(repo, pinnedBlobs) {
  const files = {};
  await walk(files, resolve(repo, "src"));
  const differences = await blobDifferences(repo, pinnedBlobs);
  const packageJSON = JSON.parse(
    await readFile(resolve(repo, "package.json"), "utf8"),
  );
  const pinnedCommit = checkedOutCommit(repo);
  return {
    pinnedCommit,
    packageVersion: packageJSON.version,
    inspectedBlobDifferences: differences,
    sourceSha256: sha256(files),
    files,
    match: differences.length === 0,
  };
}
