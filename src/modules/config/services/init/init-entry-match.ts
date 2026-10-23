// Whether a config's plugin entry already registers this package, by name, npm spec or resolved path.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageInfo } from "../../models/init-types.ts";

export function isOurEntry(
  entry: unknown,
  pkg: PackageInfo,
  directory: string,
): boolean {
  const head = entryHead(entry);
  if (head === undefined) return false;
  if (head === pkg.root || head === pkg.name || head.startsWith(`${pkg.name}@`))
    return true;
  try {
    const path = head.startsWith("file:")
      ? fileURLToPath(head)
      : resolve(directory, head);
    return realpathSync(path) === realpathSync(pkg.root);
  } catch {
    return false;
  }
}

function entryHead(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0];
  if (
    typeof entry === "object" &&
    entry !== null &&
    "package" in entry &&
    typeof entry.package === "string"
  ) {
    return entry.package;
  }
  return undefined;
}
