// Where enrichment may read: the approved evidence roots, and the sensitive paths blocked inside
// them.

import { lstat, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export const SENSITIVE_PATH =
  /(?:^|\/)(?:\.env(?:\.|$)|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/(?:gh|gcloud)(?:\/|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$|credentials(?:\.json)?$|authorized_keys$|known_hosts$|\.npmrc$|\.pypirc$|\.netrc$)/i;

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

/** Why a resolved path may not be read: outside every root, or sensitive. */
export function resolvedPathBlock(
  path: string,
  roots: string[],
  outsideReason: string,
): string | undefined {
  if (!roots.some((root) => isWithinRoot(path, root))) return outsideReason;
  if (SENSITIVE_PATH.test(path)) return "sensitive resolved path";
  return undefined;
}
