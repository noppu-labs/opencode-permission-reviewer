// Reading an OpenCode config file for `init`: a no-follow snapshot of its parsed JSONC and content fingerprint.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { stripCommentsAndTrailingCommas } from "../jsonc.ts";

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
      fingerprint: fingerprintOf(raw),
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

export function parseConfigText(raw: string): Record<string, unknown> | null {
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

export function fingerprintOf(raw: Buffer | string): string {
  return createHash("sha256").update(raw).digest("hex");
}
