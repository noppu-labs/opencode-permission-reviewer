// Config file planning and writing for `init`: snapshot, entry matching, plans, backups and writes.
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, modify } from "jsonc-parser";
import { stripCommentsAndTrailingCommas } from "../config/jsonc.ts";

interface PackageInfo {
  name: string;
  version: string;
  engines: { bun?: string; opencode?: string };
  root: string;
}

export type HostGeneration = "v1" | "v2";
type PluginEntry =
  | string
  | [string, Record<string, unknown>]
  | { package: string; options?: Record<string, unknown> };

/** Each plan is re-resolved against the current file before its write, so a
 *  file edited or created since planning refuses its write instead of acting
 *  on stale assumptions. Returns the process exit code. */
export function applyPlannedWrites(
  plans: FilePlan[],
  entry: PluginEntry,
  pkg: PackageInfo,
  host: HostGeneration = "v1",
): number {
  const written: string[] = [];
  for (const plan of plans) {
    if (plan.action === "noop") continue;
    const fresh = planFileChange(plan.path, pkg, host);
    if (
      fresh.action !== plan.action ||
      (plan.fingerprint !== undefined && fresh.fingerprint !== plan.fingerprint)
    ) {
      console.error(
        `init: ${plan.path} changed since planning (was ${plan.action}, now ${fresh.action}); refusing to write`,
      );
      return 1;
    }
    if (fresh.action === "error") {
      console.error(
        `init: ${plan.path} is malformed or has a non-array "plugin" key; refusing to write`,
      );
      return 1;
    }
    if (fresh.backup !== undefined && existsSync(plan.path)) {
      console.error(`  backup: ${writeBackup(plan.path, fresh.backup)}`);
    }
    try {
      writeEntry(
        plan.path,
        entry,
        fresh.action === "create",
        host,
        fresh.fingerprint,
      );
    } catch (error) {
      // A file created in the residual race between re-planning and writing
      // must never be clobbered; anything else is unexpected and propagates.
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
      console.error(
        `init: ${plan.path} was created concurrently; refusing to overwrite`,
      );
      return 1;
    }
    written.push(plan.path);
  }

  console.error("init: done");
  console.error("next: restart OpenCode to load the plugin");
  console.error(
    'next: ensure at least one permission "ask" rule (e.g. bash), or the plugin is a no-op',
  );
  if (plans.some((p) => p.backup)) {
    console.error(
      "rollback: restore from the .bak file above and restart OpenCode",
    );
  }

  return 0;
}

/** Copy the current file to a backup name, claiming the destination
 *  atomically: when the planned name was taken concurrently, the next free
 *  rotation name is used instead of overwriting the collision. Returns the
 *  backup path actually written. Exported for unit tests. */
export function writeBackup(source: string, preferred: string): string {
  let sourceFd: number | undefined;
  let data: Buffer;
  try {
    sourceFd = openSync(
      source,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    if (!fstatSync(sourceFd).isFile())
      throw new Error(`Config is not a regular file: ${source}`);
    data = readFileSync(sourceFd);
  } finally {
    if (sourceFd !== undefined) closeSync(sourceFd);
  }
  let dest = preferred;
  for (;;) {
    try {
      writeFileSync(dest, data, { flag: "wx", mode: 0o600 });
      return dest;
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
      dest = backupPath(source);
    }
  }
}

type ConfigSnapshot =
  | { status: "read"; config: Record<string, unknown>; fingerprint: string }
  | { status: "missing" }
  | { status: "error" };

export function readConfigFile(path: string): ConfigSnapshot {
  let fd: number | undefined;
  try {
    // The parsed config and fingerprint must describe the same opened file.
    fd = openSync(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    if (!fstatSync(fd).isFile()) return { status: "error" };
    const raw = readFileSync(fd);
    const config = parseConfigText(raw.toString("utf8"));
    if (config === null) return { status: "error" };
    return {
      status: "read",
      config,
      fingerprint: createHash("sha256").update(raw).digest("hex"),
    };
  } catch (error) {
    return {
      status:
        (error as { code?: unknown }).code === "ENOENT" ? "missing" : "error",
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseConfigText(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(stripCommentsAndTrailingCommas(raw));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isOurEntry(
  entry: unknown,
  pkg: PackageInfo,
  directory: string,
): boolean {
  let head: string | undefined;
  if (typeof entry === "string") {
    head = entry;
  } else if (Array.isArray(entry) && typeof entry[0] === "string") {
    head = entry[0];
  } else if (
    typeof entry === "object" &&
    entry !== null &&
    "package" in entry &&
    typeof entry.package === "string"
  ) {
    head = entry.package;
  }
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

interface FilePlan {
  path: string;
  action: "create" | "append" | "noop" | "error";
  backup?: string;
  fingerprint?: string;
}

export type { FilePlan, PackageInfo, PluginEntry };

export function planFileChange(
  path: string,
  pkg: PackageInfo,
  host: HostGeneration = "v1",
): FilePlan {
  const snapshot = readConfigFile(path);
  if (snapshot.status === "missing") return { path, action: "create" };
  if (snapshot.status === "error") return { path, action: "error" };
  const { config: cfg, fingerprint } = snapshot;
  const plugin = cfg[host === "v2" ? "plugins" : "plugin"];
  if (plugin === undefined) {
    return { path, action: "append", backup: backupPath(path), fingerprint };
  }
  if (!Array.isArray(plugin)) {
    return { path, action: "error" };
  }
  const matching = plugin.filter((entry) =>
    isOurEntry(entry, pkg, dirname(path)),
  );
  if (matching.length > 1) return { path, action: "error" };
  if (matching.length === 1) {
    const existing = matching[0];
    const isObject =
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing);
    if (isObject !== (host === "v2")) return { path, action: "error" };
    const spec =
      typeof existing === "string"
        ? existing
        : Array.isArray(existing)
          ? existing[0]
          : existing.package;
    if (
      typeof spec === "string" &&
      spec.startsWith(`${pkg.name}@`) &&
      spec !== `${pkg.name}@${pkg.version}`
    )
      return { path, action: "error" };
    return { path, action: "noop" };
  }
  return { path, action: "append", backup: backupPath(path), fingerprint };
}

function backupPath(path: string): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let bak = `${path}.bak-${stamp}`;
  for (let i = 2; existsSync(bak); i++) bak = `${path}.bak-${stamp}-${i}`;
  return bak;
}

export function writeEntry(
  path: string,
  entry: PluginEntry,
  create: boolean,
  host: HostGeneration = "v1",
  fingerprint?: string,
): void {
  const key = host === "v2" ? "plugins" : "plugin";
  if (create) {
    mkdirSync(dirname(path), { recursive: true });
    const schema =
      path.includes("tui.json") || path.includes("tui.jsonc")
        ? "https://opencode.ai/tui.json"
        : "https://opencode.ai/config.json";
    const fresh: Record<string, unknown> = path.endsWith("cli.json")
      ? { [key]: [entry] }
      : { $schema: schema, [key]: [entry] };
    // Exclusive create: a file that appeared after planning is never
    // clobbered; the EEXIST failure maps to a refusal in the caller.
    writeFileSync(path, `${JSON.stringify(fresh, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return;
  }
  let fd: number | undefined;
  try {
    // Hold one no-follow descriptor from validation through the write. A config
    // swapped for a symlink between those steps can no longer redirect the CLI
    // into overwriting another file.
    fd = openSync(
      path,
      fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    if (!fstatSync(fd).isFile())
      throw new Error("Config is not a regular file");
    const raw = readFileSync(fd, "utf8");
    if (
      fingerprint !== undefined &&
      createHash("sha256").update(raw).digest("hex") !== fingerprint
    ) {
      throw new Error("Config changed after planning; refusing to overwrite");
    }
    const cfg = parseConfigText(raw);
    if (!cfg || (cfg[key] !== undefined && !Array.isArray(cfg[key])))
      throw new Error("Invalid plugin config");
    const edits = modify(
      raw.trim() ? raw : "{}",
      cfg[key] === undefined ? [key] : [key, -1],
      cfg[key] === undefined ? [entry] : entry,
      {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
      },
    );
    const data = Buffer.from(
      applyEdits(raw.trim() ? raw : "{}", edits),
      "utf8",
    );
    ftruncateSync(fd, 0);
    let written = 0;
    while (written < data.length) {
      written += writeSync(fd, data, written, data.length - written, written);
    }
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
