// Mutating forms (delete, write, execute) of the find, sort and yq tools the analyzer otherwise treats as read-only.

import { elementAt } from "../element-at.ts";
import type { ShellToken } from "../shell-token.ts";

/** Mutating forms of executables that are otherwise treated as read-only.
 *  "This executable usually only reads" must never become "this invocation
 *  only reads": find/sort/yq all have flags that delete, write, or execute. */
interface ReadOnlyToolMutation {
  deletion?: boolean;
  executesCode?: boolean;
  /** Paths written or (for -delete) destroyed, classified like any write. */
  writeTargets: string[];
}

/** Placeholder target when a mutating form names no operand: conservatively
 *  treated as a workspace write (the current directory). */
const directoryFallback = ".";

export function readOnlyToolMutation(
  cmd: ShellToken[],
  base: string,
): ReadOnlyToolMutation | undefined {
  if (base === "find") return findMutation(cmd);
  if (base === "sort") return sortMutation(cmd);
  if (base === "yq") return yqMutation(cmd);
  return undefined;
}

function findMutation(cmd: ShellToken[]): ReadOnlyToolMutation | undefined {
  let index = findRootsStart(cmd);
  const roots: string[] = [];
  let root = cmd[index];
  while (root !== undefined && isFindRoot(root.value)) {
    roots.push(root.value);
    index += 1;
    root = cmd[index];
  }
  const result: ReadOnlyToolMutation = { writeTargets: [] };
  for (; index < cmd.length; index += 1)
    applyFindAction(cmd, index, roots, result);
  return result.deletion ||
    result.executesCode ||
    result.writeTargets.length > 0
    ? result
    : undefined;
}

/** Whether a word can be a search root: not an option, `!` or `(`. */
function isFindRoot(value: string): boolean {
  return !value.startsWith("-") && value !== "!" && value !== "(";
}

/** GNU find accepts traversal options before its search roots. In
 *  particular, `-D` consumes a separate diagnostics value; treating that
 *  value as the root would hide a later `/ -delete`. Returns the index just
 *  past those options. */
function findRootsStart(cmd: ShellToken[]): number {
  let index = 1;
  while (index < cmd.length) {
    const value = elementAt(cmd, index, "cmd").value;
    if (value === "--") return index + 1;
    const width = findTraversalOptionWidth(value);
    if (width === 0) return index;
    index += width;
  }
  return index;
}

const FIND_SYMLINK_OPTIONS = new Set(["-H", "-L", "-P"]);

/** Words a leading find traversal option spans, or 0 for any other word. */
function findTraversalOptionWidth(value: string): number {
  if (value === "-D") return 2;
  if (FIND_SYMLINK_OPTIONS.has(value) || /^-O\d+$/.test(value)) return 1;
  return 0;
}

function applyFindAction(
  cmd: ShellToken[],
  index: number,
  roots: string[],
  result: ReadOnlyToolMutation,
): void {
  const value = elementAt(cmd, index, "cmd").value;
  if (value === "-delete") {
    result.deletion = true;
    result.writeTargets.push(...roots);
  } else if (value.startsWith("-exec") || value.startsWith("-ok")) {
    // -exec / -execdir / -ok / -okdir run an arbitrary command per match.
    result.executesCode = true;
  } else if (value === "-fls" || value.startsWith("-fprint")) {
    pushOptionValue(cmd, index, result.writeTargets);
  }
}

/** Push the word after the option at `index`, unless it is missing or looks
 *  like another option. */
function pushOptionValue(
  cmd: ShellToken[],
  index: number,
  targets: string[],
): void {
  const target = cmd[index + 1]?.value;
  if (target !== undefined && !target.startsWith("-")) targets.push(target);
}

function sortMutation(cmd: ShellToken[]): ReadOnlyToolMutation | undefined {
  const result: ReadOnlyToolMutation = { writeTargets: [] };
  for (let index = 1; index < cmd.length; index += 1) {
    const value = elementAt(cmd, index, "cmd").value;
    if (value === "-o" || value === "--output") {
      pushOptionValue(cmd, index, result.writeTargets);
    } else if (value.startsWith("--output=")) {
      result.writeTargets.push(value.slice("--output=".length));
    } else if (value.startsWith("-o") && value.length > 2) {
      result.writeTargets.push(value.slice(2));
    }
  }
  return result.writeTargets.length > 0 ? result : undefined;
}

/** In-place edit: every non-option operand, the expression included, is recorded as a write target. */
function yqMutation(cmd: ShellToken[]): ReadOnlyToolMutation | undefined {
  if (!cmd.some((token) => token.value === "-i" || token.value === "--inplace"))
    return undefined;
  const targets = cmd
    .slice(1)
    .map((token) => token.value)
    .filter((value) => !value.startsWith("-"));
  return targets.length > 0
    ? { writeTargets: targets }
    : { writeTargets: [directoryFallback] };
}
