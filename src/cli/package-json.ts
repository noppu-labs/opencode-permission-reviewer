// The upward package.json search `init` and `doctor` share to read this package's own manifest.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface PackageManifest {
  name?: string;
  version?: string;
  engines?: { bun?: string; opencode?: string };
}

/** Locate the nearest package.json by walking up from `start`, at most eight
 *  levels. The CLI lives at <root>/src/cli (source) or <root>/dist (bundle),
 *  so the package root is a different number of levels up in each layout;
 *  searching upward works for both. Returns undefined when none is found. */
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
