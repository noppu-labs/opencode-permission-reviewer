// Writing `init`'s config changes: the exclusive backup copy, the exclusive create and the in-place append.
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import {
  type HostGeneration,
  type PluginEntry,
  pluginKey,
} from "../../models/init-types.ts";
import { backupPath } from "./init-config-files.ts";
import { fingerprintOf, parseConfigText } from "./init-config-read.ts";

/** Copy the current file to a backup name, claiming the destination
 *  atomically: when the planned name was taken concurrently, the next free
 *  rotation name is used instead of overwriting the collision. Returns the
 *  backup path actually written. */
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

export function writeEntry(
  path: string,
  entry: PluginEntry,
  create: boolean,
  host: HostGeneration = "v1",
  fingerprint?: string,
): void {
  const key = pluginKey(host);
  if (create) {
    createConfig(path, entry, key);
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
    overwrite(fd, appendedConfig(raw, entry, key, fingerprint));
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function createConfig(path: string, entry: PluginEntry, key: string): void {
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
}

function appendedConfig(
  raw: string,
  entry: PluginEntry,
  key: string,
  fingerprint: string | undefined,
): Buffer {
  if (fingerprint !== undefined && fingerprintOf(raw) !== fingerprint) {
    throw new Error("Config changed after planning; refusing to overwrite");
  }
  const cfg = parseConfigText(raw);
  if (!cfg || (cfg[key] !== undefined && !Array.isArray(cfg[key])))
    throw new Error("Invalid plugin config");
  const text = raw.trim() ? raw : "{}";
  const missing = cfg[key] === undefined;
  const edits = modify(
    text,
    missing ? [key] : [key, -1],
    missing ? [entry] : entry,
    {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    },
  );
  return Buffer.from(applyEdits(text, edits), "utf8");
}

function overwrite(fd: number, data: Buffer): void {
  ftruncateSync(fd, 0);
  let written = 0;
  while (written < data.length) {
    written += writeSync(fd, data, written, data.length - written, written);
  }
  fsyncSync(fd);
}
