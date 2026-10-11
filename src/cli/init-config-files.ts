// Planning `init`'s change to one config file: create, append with a backup, noop when already registered, or error.
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { readConfigFile } from "./init-config-read.ts";
import { isOurEntry } from "./init-entry-match.ts";
import {
  type FilePlan,
  type HostGeneration,
  type PackageInfo,
  pluginKey,
} from "./init-types.ts";

export function planFileChange(
  path: string,
  pkg: PackageInfo,
  host: HostGeneration = "v1",
): FilePlan {
  const snapshot = readConfigFile(path);
  if (snapshot.status === "missing") return { path, action: "create" };
  if (snapshot.status === "error") return { path, action: "error" };
  const { config: cfg, fingerprint } = snapshot;
  const plugin = cfg[pluginKey(host)];
  if (plugin === undefined) return appendPlan(path, fingerprint);
  if (!Array.isArray(plugin)) {
    return { path, action: "error" };
  }
  const action = existingEntryAction(plugin, pkg, host, dirname(path));
  return action === undefined
    ? appendPlan(path, fingerprint)
    : { path, action };
}

function appendPlan(path: string, fingerprint: string): FilePlan {
  return { path, action: "append", backup: backupPath(path), fingerprint };
}

/** The action for a plugin array that already names this package, or
 *  undefined when no entry matches and the entry should be appended. */
function existingEntryAction(
  plugin: unknown[],
  pkg: PackageInfo,
  host: HostGeneration,
  directory: string,
): "noop" | "error" | undefined {
  const matching = plugin.filter((entry) => isOurEntry(entry, pkg, directory));
  if (matching.length > 1) return "error";
  if (matching.length === 0) return undefined;
  const existing = matching[0];
  const isObject =
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing);
  if (isObject !== (host === "v2")) return "error";
  const spec = entrySpec(existing);
  if (
    typeof spec === "string" &&
    spec.startsWith(`${pkg.name}@`) &&
    spec !== `${pkg.name}@${pkg.version}`
  )
    return "error";
  return "noop";
}

function entrySpec(existing: unknown): unknown {
  if (typeof existing === "string") return existing;
  if (Array.isArray(existing)) return existing[0];
  return (existing as { package?: unknown }).package;
}

export function backupPath(path: string): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let bak = `${path}.bak-${stamp}`;
  for (let i = 2; existsSync(bak); i++) bak = `${path}.bak-${stamp}-${i}`;
  return bak;
}
