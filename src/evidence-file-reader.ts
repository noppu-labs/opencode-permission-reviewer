// Evidence file reading: approved roots, contained descriptor-verified reads, and missing-file retry.

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  type FileHandle,
  lstat,
  open,
  readlink,
  realpath,
} from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

const O_RDONLY: number =
  typeof fsConstants.O_RDONLY === "number" ? fsConstants.O_RDONLY : 0;
const O_NOFOLLOW: number =
  typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
const O_NONBLOCK: number =
  typeof fsConstants.O_NONBLOCK === "number" ? fsConstants.O_NONBLOCK : 0;

export interface FileEvidence {
  source: "file";
  path: string;
  status: "included" | "truncated" | "unavailable" | "blocked";
  reason?: string;
  size?: number;
  includedBytes?: number;
  includedSha256?: string;
  content?: string;
}

const SENSITIVE_PATH =
  /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/(?:gh|gcloud)(?:\/|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$|credentials(?:\.json)?$|authorized_keys$|known_hosts$|\.npmrc$|\.pypirc$|\.netrc$)/i;
const SENSITIVE_CONTENT =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk|nvapi)-[A-Za-z0-9_-]{16,}|\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9_-]{16,}|\bgithub_pat_[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*["'][^"'\n]{8,}["']/i;

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Whether `path` equals `root` or lives somewhere below it. */
export function isWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/** The only roots enrichment may read or inspect below: the session's
 *  initial directory, the workspace worktree, and the reviewer temp area.
 *  Directories tracked through a `cd` in the reviewed command are resolution
 *  bases, never roots: a command cannot mint the right to enrich from
 *  somewhere else. Roots are re-validated on every enrichment read, so a
 *  swapped path between two reads re-fails the check instead of widening
 *  scope mid-request. */
export async function approvedEvidenceRoots(
  rootDirectory: string,
  worktree?: string,
  temporaryPath: string = "/tmp/opencode", // NOSONAR(S5443) only a path string for the approved-root check: it is lstat-ed and must be an owned, non-writable directory; nothing is created or written there
): Promise<string[]> {
  const [directoryRoot, worktreeRoot, temporaryRoot] = await Promise.all([
    realpath(rootDirectory).catch(() => resolve(rootDirectory)),
    worktree === undefined
      ? undefined
      : realpath(worktree).catch(() => resolve(worktree)),
    temporaryEvidenceRoot(temporaryPath),
  ]);
  return [
    directoryRoot,
    ...(worktreeRoot === undefined ? [] : [worktreeRoot]),
    ...(temporaryRoot === undefined ? [] : [temporaryRoot]),
  ];
}

/** The temp area qualifies as an evidence root only when it is exactly the
 *  directory it claims to be: a real directory (a symlink would quietly make
 *  whatever it points to readable), owned by the current user, and not
 *  group- or world-writable (anyone could otherwise plant or replace the
 *  files enrichment reads). Anything else, including absence, drops the
 *  root: enrichment simply cannot use it, which fails closed. */
async function temporaryEvidenceRoot(
  path: string,
): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) return undefined;
    if (typeof process.getuid === "function") {
      const uid = process.getuid();
      if (typeof info.uid === "number" && info.uid !== uid) return undefined;
    }
    if (info.mode & 0o022) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

/** Best-effort Linux-only resolution of an open descriptor back to its real
 *  path (`/proc/self/fd/<n>`). Returns undefined where /proc is unavailable
 *  (non-Linux platforms, hardened containers): the caller then keeps the
 *  pre-open checks as the only line of defense, which is the documented
 *  limitation rather than a silent pass. */
async function descriptorRealPath(fd: number): Promise<string | undefined> {
  try {
    return await readlink(`/proc/self/fd/${fd}`);
  } catch {
    return undefined;
  }
}

function blocked(path: string, reason: string): FileEvidence {
  return { source: "file", path, status: "blocked", reason };
}

/** Why a resolved path may not be read: outside every root, or sensitive. */
function resolvedPathBlock(
  path: string,
  roots: string[],
  outsideReason: string,
): string | undefined {
  if (!roots.some((root) => isWithinRoot(path, root))) return outsideReason;
  if (SENSITIVE_PATH.test(path)) return "sensitive resolved path";
  return undefined;
}

async function includeFileOnce(
  source: string,
  directory: string,
  rootDirectory: string,
  worktree: string,
  maxChars: number,
): Promise<FileEvidence> {
  // `directory` is only the RESOLUTION base: it may be a working directory
  // tracked across a `cd` in the very command under review, so it can never
  // mint approved read roots. Containment is judged against `rootDirectory`
  // (the session's initial directory), the worktree, and /tmp/opencode: a
  // `cd /outside && python x.py` resolves in /outside but stays blocked.
  const resolved = resolve(directory, source);
  if (SENSITIVE_PATH.test(resolved)) return blocked(resolved, "sensitive path");

  try {
    // Resolve the source independently so ENOENT can only mean that this
    // specific stdin file is missing, never that an auxiliary root vanished.
    const actual = await realpath(resolved);
    const roots = await approvedEvidenceRoots(rootDirectory, worktree);
    const actualBlock = resolvedPathBlock(
      actual,
      roots,
      "outside approved enrichment roots",
    );
    if (actualBlock !== undefined) return blocked(resolved, actualBlock);

    // Open first, then verify through the open descriptor (fstat): the checks
    // above judged a path, and the descriptor is the only thing guaranteed to
    // match what we actually read. O_NOFOLLOW (where available) rejects a
    // last-component symlink swapped in between realpath and open. O_NONBLOCK
    // keeps the open from BLOCKING on a FIFO with no writer — without it the
    // review would hang before fstat ever got the chance to reject the
    // non-regular file; on regular files the flag is a no-op.
    const limit = Math.max(1, maxChars);
    const handle = await open(actual, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    try {
      return await readOpenedFile(handle, resolved, roots, limit);
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      source: "file",
      path: isAbsolute(source) ? source : resolved,
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readOpenedFile(
  handle: FileHandle,
  resolved: string,
  roots: string[],
  limit: number,
): Promise<FileEvidence> {
  const info = await handle.stat();
  if (!info.isFile()) {
    return {
      source: "file",
      path: resolved,
      status: "unavailable",
      reason: "not a regular file",
    };
  }
  // O_NOFOLLOW only guards the LAST path component. On Linux, resolve the
  // open descriptor back to its real path and re-run the containment and
  // sensitivity checks against what is actually being read: an
  // intermediate directory swapped for a symlink between the realpath
  // check and the open is then caught instead of silently reading outside
  // the approved roots.
  const fdPath = await descriptorRealPath(handle.fd);
  if (fdPath !== undefined) {
    const fdBlock = resolvedPathBlock(
      fdPath,
      roots,
      `open descriptor resolves outside approved enrichment roots (${fdPath})`,
    );
    if (fdBlock !== undefined) return blocked(resolved, fdBlock);
  }
  const buffer = Buffer.alloc(Math.min(info.size, limit + 1));
  const bytesRead = await fillBuffer(handle, buffer);
  return contentEvidence(resolved, buffer, bytesRead, info.size, limit);
}

// A single read is not guaranteed to fill the buffer, so loop until
// full or EOF. A short total means the file shrank mid-read; the status
// then reports truncation instead of silently covering fewer
// bytes than the size claims.
async function fillBuffer(handle: FileHandle, buffer: Buffer): Promise<number> {
  let bytesRead = 0;
  while (bytesRead < buffer.length) {
    // biome-ignore lint/performance/noAwaitInLoops: each read fills the buffer from the offset where the previous read stopped, and a zero-byte read ends the loop at EOF
    const { bytesRead: count } = await handle.read(
      buffer,
      bytesRead,
      buffer.length - bytesRead,
      bytesRead,
    );
    if (count === 0) break;
    bytesRead += count;
  }
  return bytesRead;
}

function contentEvidence(
  path: string,
  buffer: Buffer,
  bytesRead: number,
  size: number,
  limit: number,
): FileEvidence {
  const shortRead = bytesRead < buffer.length;
  const included = buffer.subarray(0, Math.min(bytesRead, limit));
  const content = included.toString("utf8");
  const replacementCount = [...content].filter(
    (character) => character === "\uFFFD",
  ).length;
  if (
    included.includes(0) ||
    replacementCount > Math.max(2, content.length / 100)
  ) {
    return {
      source: "file",
      path,
      status: "blocked",
      reason: "binary or non-text content",
      size,
    };
  }
  if (SENSITIVE_CONTENT.test(content)) {
    return {
      source: "file",
      path,
      status: "blocked",
      reason: "possible literal credential or private key",
      size,
      includedSha256: sha256(included),
    };
  }
  return {
    source: "file",
    path,
    status: size > limit || shortRead ? "truncated" : "included",
    size,
    includedBytes: included.length,
    includedSha256: sha256(included),
    content,
  };
}

export function isMissingFile(result: FileEvidence): boolean {
  return (
    result.status === "unavailable" &&
    /\bENOENT\b|no such file or directory/i.test(result.reason ?? "")
  );
}

export async function includeEvidenceFile(
  source: string,
  directory: string,
  rootDirectory: string,
  worktree: string,
  maxChars: number,
): Promise<FileEvidence> {
  const first = await includeFileOnce(
    source,
    directory,
    rootDirectory,
    worktree,
    maxChars,
  );
  if (!isMissingFile(first)) return first;
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
  return includeFileOnce(source, directory, rootDirectory, worktree, maxChars);
}
