// The upward package.json search `init` and `doctor` share to read this package's own manifest.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface PackageManifest {
  name?: string;
  version?: string;
  engines?: { bun?: string; opencode?: string };
}

/** The CLI runs from `<root>/src/cli` (source) or `<root>/dist` (bundle), so
 *  the package root is a different number of levels up in each; walking up
 *  works for both. */
export function findPackageJson(
  start: string,
): { dir: string; manifest: PackageManifest } | undefined {
  let dir = start;
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const manifest = JSON.parse(
        readFileSync(candidate, "utf8"),
      ) as PackageManifest;
      return { dir, manifest };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
