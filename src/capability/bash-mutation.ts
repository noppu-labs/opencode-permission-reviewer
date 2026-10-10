// Path classification, redirection, network-destination and literal-path helpers for the bash capability analyzer.

import { homedir } from "node:os";
import { normalize, resolve, sep } from "node:path";
import type { ShellToken } from "../shell-token.ts";
import type { Redirection } from "./capability-types.ts";

export function hasWriteRedirect(redirections: Redirection[]): boolean {
  return redirections.some(redirectionWritesPath);
}

export function redirectionWritesPath(redirection: Redirection): boolean {
  const operator = redirection.operator.replace(/^\d+/, "");
  if ([">", ">>", ">|", "&>", "&>>", "<>"].includes(operator)) return true;
  // Without an explicit IO number, `>&file` is the historical spelling of
  // redirecting stdout and stderr to a file. `2>&1` only duplicates an FD.
  return (
    operator === ">&" &&
    !/^\d/.test(redirection.operator) &&
    redirection.target !== "-" &&
    !/^\d+$/.test(redirection.target)
  );
}

/** Classify a path target as temporary, workspace, or external. Relative
 *  targets (including `..` segments and `~/` homes) are resolved against the
 *  working directory first, and ABSOLUTE targets are lexically normalized, so
 *  neither `../../outside` nor `/worktree/../etc` can masquerade as a
 *  workspace path through a prefix it only appears to have. Lexical
 *  normalization cannot resolve symlinked directory components — the class
 *  always describes the stated path, not a filesystem-verified destination. */
export function classifyPath(
  target: string,
  directory: string,
  worktree: string,
): { temporary: boolean; workspace: boolean; external: boolean } {
  if (!target || target.startsWith("&"))
    return { temporary: false, workspace: false, external: false };
  const absolute = absoluteTarget(target, directory);
  if (!absolute.startsWith("/") && !WINDOWS_ABSOLUTE.test(absolute)) {
    // A path that still has no absolute form cannot be classified.
    return { temporary: false, workspace: false, external: false };
  }
  const workspace =
    isWithin(absolute, directory) || isWithin(absolute, worktree);
  const temp = isTemporaryPath(absolute);
  return { temporary: temp, workspace, external: !workspace && !temp };
}

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

function absoluteTarget(target: string, directory: string): string {
  if (target === "~" || target.startsWith("~/"))
    return resolve(homedir(), target.slice(target === "~" ? 1 : 2));
  if (!target.startsWith("/") && !WINDOWS_ABSOLUTE.test(target))
    return resolve(directory, target);
  return normalize(target);
}

function isWithin(absolute: string, root: string): boolean {
  const normalizedRoot = normalize(root);
  return (
    absolute === normalizedRoot ||
    absolute.startsWith(`${normalizedRoot}${sep}`)
  );
}

function isTemporaryPath(absolute: string): boolean {
  return (
    absolute === "/tmp" ||
    absolute.startsWith("/tmp/") || // NOSONAR(S5443) classifies the target path of a command as temporary; no file is created or used here
    absolute === "/var/tmp" ||
    absolute.startsWith("/var/tmp/") || // NOSONAR(S5443) classifies the target path of a command as temporary; no file is created or used here
    absolute === "/dev/shm" ||
    absolute.startsWith("/dev/shm/") || // NOSONAR(S5443) classifies the target path of a command as temporary; no file is created or used here
    absolute === "/dev/null"
  );
}

export function destinationFromTokens(tokens: ShellToken[]): string[] {
  const out: string[] = [];
  for (const token of tokens.slice(1)) {
    const v = token.value;
    if (/^[a-z][a-z0-9+.-]*:\/\/[^\s]+/.test(v)) out.push(v);
    else if (/^[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(\/[^\s]*)?$/i.test(v))
      out.push(v);
  }
  return out;
}

/** Whether a token value is a static literal path candidate. Dynamic values
 *  (variables, command substitution, globs) never count as credential reads:
 *  the analyzer cannot resolve what they point at. */
export function isLiteralPathValue(value: string): boolean {
  if (!value) return false;
  if (/[$`*?[\]{}]/.test(value)) return false;
  return true;
}
