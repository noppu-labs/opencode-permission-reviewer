import { fstatSync, openSync } from "node:fs";
import {
  closeQuietly,
  O_NOFOLLOW,
  O_NONBLOCK,
  O_RDONLY,
  readFully,
} from "../descriptor-io.ts";
import { parseJsoncStrict } from "./jsonc.ts";

/** Cap on a single config file read: the project layer is repository-controlled
 *  and read at startup, so an unbounded read lets a committed symlink to an
 *  endless source exhaust memory. A file over the cap is treated like any
 *  other unreadable layer (warned about and ignored). */
const CONFIG_READ_CAP_BYTES = 1024 * 1024;

export type ConfigLayer =
  | {
      raw: Record<string, unknown>;
      status: "missing" | "ok";
      warning?: undefined;
    }
  | {
      raw: Record<string, unknown>;
      status: "read-error" | "malformed";
      /** A silently unreadable trusted layer must be visible, not
       *  indistinguishable from an absent one. */
      warning: string;
    };

type LayerText = ConfigLayer | { status: "ok"; text: string };

/** Read a JSONC config file. A missing file is the common case (status
 *  "missing", no warning). A file that exists but cannot be read or parsed
 *  keeps the plugin working with an empty layer, but the status lets the
 *  caller treat an unusable TRUSTED layer as a fail-closed condition rather
 *  than silently falling back to defaults.
 *
 *  The read goes through an explicitly opened descriptor: O_NOFOLLOW rejects
 *  a symlinked layer (a committed link to a FIFO would otherwise hang startup
 *  and a link to an endless source would exhaust memory), O_NONBLOCK keeps a
 *  FIFO from blocking before fstat can reject it, fstat requires a regular
 *  file, and the byte cap bounds the read. */
export function readConfigLayer(path: string): ConfigLayer {
  const read = readLayerText(path);
  if (!("text" in read)) return read;
  try {
    return { raw: parseJsoncStrict(read.text), status: "ok" };
  } catch (error) {
    return {
      raw: {},
      status: "malformed",
      warning: `permission-reviewer config at ${path} is malformed and was ignored (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

function readError(warning: string): ConfigLayer {
  return { raw: {}, status: "read-error", warning };
}

function unreadable(path: string, error: unknown): ConfigLayer {
  const code = (error as { code?: unknown }).code;
  return readError(
    `permission-reviewer config at ${path} exists but could not be read (${code ?? "unknown error"}); the layer was ignored`,
  );
}

/** Read at most the capped bytes through the open descriptor; anything but a
 *  missing file that stops the read becomes a `read-error` layer. Never
 *  throws. */
function readLayerText(path: string): LayerText {
  let fd: number | undefined;
  try {
    const opened = openLayer(path);
    if (typeof opened !== "number") return opened;
    fd = opened;
    return readOpenLayer(fd, path);
  } catch (error) {
    return unreadable(path, error);
  } finally {
    closeQuietly(fd);
  }
}

function openLayer(path: string): number | ConfigLayer {
  try {
    // Read-only descriptor open of an existing config path; no file is
    // created here and the descriptor must pass the regular-file check below.
    // codeql[js/insecure-temporary-file]
    return openSync(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT")
      return { raw: {}, status: "missing" };
    return unreadable(path, error);
  }
}

function readOpenLayer(fd: number, path: string): LayerText {
  const info = fstatSync(fd);
  if (!info.isFile()) {
    return readError(
      `permission-reviewer config at ${path} is not a regular file and was ignored`,
    );
  }
  if (info.size > CONFIG_READ_CAP_BYTES) {
    return readError(
      `permission-reviewer config at ${path} exceeds the size limit (${CONFIG_READ_CAP_BYTES} bytes) and was ignored`,
    );
  }
  return { status: "ok", text: readBytes(fd, info.size) };
}

function readBytes(fd: number, length: number): string {
  const buffer = Buffer.alloc(length);
  const read = readFully(fd, buffer, length, 0);
  // A concurrent shrink can end the read early; decode only the bytes
  // actually read so no zero-padding leaks into the parser.
  return (read < length ? buffer.subarray(0, read) : buffer).toString("utf8");
}
