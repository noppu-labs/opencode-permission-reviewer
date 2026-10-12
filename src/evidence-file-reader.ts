// Evidence file reading: contained, descriptor-verified reads below the approved roots, and the
// missing-file retry.

import { constants as fsConstants } from "node:fs";
import { type FileHandle, open, readlink, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { contentEvidence, fillBuffer } from "./evidence-content.ts";
import {
  approvedEvidenceRoots,
  resolvedPathBlock,
  SENSITIVE_PATH,
} from "./evidence-path-policy.ts";
import { type FileEvidence, isMissingFile } from "./file-evidence.ts";

const O_RDONLY: number =
  typeof fsConstants.O_RDONLY === "number" ? fsConstants.O_RDONLY : 0;
const O_NOFOLLOW: number =
  typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
const O_NONBLOCK: number =
  typeof fsConstants.O_NONBLOCK === "number" ? fsConstants.O_NONBLOCK : 0;

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
