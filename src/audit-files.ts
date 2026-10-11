// The audit file's descriptor-level IO: the bounded tail read behind the
// summary, and the hardened append behind the writer.
import { fchmodSync, fstatSync, openSync, readSync, writeSync } from "node:fs";
import {
  closeQuietly,
  O_APPEND,
  O_CREAT,
  O_NOFOLLOW,
  O_NONBLOCK,
  O_RDONLY,
  O_WRONLY,
  readFully,
} from "./descriptor-io.ts";

/** Cap on how much of an audit file the summary reader will pull into memory:
 *  the file is append-only and grows without bound, and the report only needs
 *  the most recent records. When the cap is hit the reader summarizes the tail
 *  (newest records) and flags the truncation. */
const AUDIT_READ_CAP_BYTES = 64 * 1024 * 1024;

export interface AuditTail {
  text: string;
  truncated: boolean;
}

/** Read the (bounded) tail of an audit file synchronously without loading the
 *  whole file. The size and the bytes both come from the open descriptor, so
 *  the window matches the data actually read. Never throws: any failure to
 *  open/stat/read returns undefined and the caller reports the file as
 *  unreadable. */
export function readTail(path: string): AuditTail | undefined {
  let fd: number | undefined;
  try {
    // O_NOFOLLOW rejects a symlinked audit path and O_NONBLOCK keeps a FIFO
    // from blocking the CLI before fstat can reject the non-regular file.
    fd = openSync(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile()) return undefined;
    return readWindow(fd, info.size);
  } catch {
    return undefined;
  } finally {
    closeQuietly(fd);
  }
}

function readWindow(fd: number, size: number): AuditTail {
  const truncated = size > AUDIT_READ_CAP_BYTES;
  const length = truncated ? AUDIT_READ_CAP_BYTES : size;
  const buffer = Buffer.alloc(length);
  const offset = truncated ? size - length : 0;
  const atLineBoundary =
    truncated && offset > 0 ? startsAtLineBoundary(fd, offset) : false;
  const read = readFully(fd, buffer, length, offset);
  // A shrink after fstat can end the read early; decode only the bytes
  // actually read so no zero-padding leaks into the text.
  let text = (read < length ? buffer.subarray(0, read) : buffer).toString(
    "utf8",
  );
  if (truncated && !atLineBoundary) {
    // Drop a possibly partial first line so every summarized line is whole.
    text = text.replace(/^[^\n]*\n/, "");
  }
  return { text, truncated };
}

/** A window that starts mid-file may begin mid-line: a newline in the byte
 *  before it means the first line is whole. A failed peek drops the first
 *  line, which costs at most one line of the report. */
function startsAtLineBoundary(fd: number, offset: number): boolean {
  try {
    const probe = Buffer.alloc(1);
    const seen = readSync(fd, probe, 0, 1, offset - 1);
    return seen === 1 && probe[0] === 0x0a;
  } catch {
    return false;
  }
}

/** Append one JSONL line through an explicitly opened descriptor: `O_NOFOLLOW`
 *  rejects a symlinked audit path, `O_NONBLOCK` makes a write-open on a
 *  readerless FIFO fail with `ENXIO` instead of hanging the host, and the
 *  descriptor must be a regular file. Mode 0600 is enforced on every append,
 *  so a pre-existing group- or world-readable file is tightened before it gets
 *  new records, or the append fails. Throws on failure; the caller logs and
 *  swallows. */
export function appendAuditLine(path: string, line: string): void {
  let fd: number | undefined;
  try {
    // One atomic open covers creation and append without a path check or retry.
    // The creation mode closes the umask window before the first record.
    fd = openSync(
      path,
      O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW | O_NONBLOCK,
      0o600,
    );
    const info = fstatSync(fd);
    if (!info.isFile()) {
      throw new Error(`not a regular file: ${path}`);
    }
    try {
      // 0o7777 so setuid/setgid residue also counts as wrong.
      if ((info.mode & 0o7777) !== 0o600) fchmodSync(fd, 0o600);
    } catch (error) {
      throw new Error(
        `cannot enforce mode 0600 on the audit path (chmod 600 it or fix its ownership): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    const data = Buffer.from(line, "utf8");
    let written = 0;
    while (written < data.length) {
      const count = writeSync(fd, data, written, data.length - written);
      written += count;
    }
  } finally {
    closeQuietly(fd);
  }
}
