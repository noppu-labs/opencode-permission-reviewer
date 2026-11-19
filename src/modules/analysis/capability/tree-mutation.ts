import { elementAt } from "../../../utils/element-at.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import {
  directoryFallback,
  type ReadOnlyToolMutation,
} from "./models/read-only-tool-mutation.ts";

/** tree's short options whose value is the next unused word. `-L` also takes
 *  its value as digits attached inside the cluster (`-L2`). */
const TREE_VALUED_LETTERS = new Set(["L", "P", "I", "H", "T", "o"]);

/** tree's long options with a value, which is inline (`--sort=name`) or the
 *  next word. tree matches each by prefix. */
const TREE_VALUED_LONG = [
  "--authority",
  "--charset",
  "--compress",
  "--filelimit",
  "--gitfile",
  "--hintro",
  "--houtro",
  "--infofile",
  "--scheme",
  "--sort",
  "--timefmt",
];

interface TreeScan {
  roots: string[];
  outputs: string[];
  recursive: boolean;
}

/** tree: `-o FILE` writes FILE, and `-R` writes an `00Tree.html` listing into
 *  each directory it visits. Options may follow the roots. */
export function treeMutation(
  cmd: ShellToken[],
): ReadOnlyToolMutation | undefined {
  const scan: TreeScan = { roots: [], outputs: [], recursive: false };
  let index = 1;
  while (index < cmd.length) {
    const value = elementAt(cmd, index, "cmd").value;
    if (value === "--") {
      scan.roots.push(...cmd.slice(index + 1).map((token) => token.value));
      break;
    }
    index += treeWord(cmd, index, scan);
  }
  const writeTargets = [...scan.outputs];
  if (scan.recursive)
    writeTargets.push(
      ...(scan.roots.length > 0 ? scan.roots : [directoryFallback]),
    );
  return writeTargets.length > 0 ? { writeTargets } : undefined;
}

/** Scan the word at `index`; returns the words it spans. */
function treeWord(cmd: ShellToken[], index: number, scan: TreeScan): number {
  const value = elementAt(cmd, index, "cmd").value;
  if (value.startsWith("--"))
    return TREE_VALUED_LONG.some(
      (name) => value.startsWith(name) && value.charAt(name.length) !== "=",
    )
      ? 2
      : 1;
  if (!value.startsWith("-") || value === "-") {
    scan.roots.push(value);
    return 1;
  }
  return 1 + treeShortOptions(cmd, index, scan);
}

/** Scan a short-option cluster. Each letter that takes a value consumes the
 *  next unused word, in order (`-Lo 2 out.txt`). Returns how many it used. */
function treeShortOptions(
  cmd: ShellToken[],
  index: number,
  scan: TreeScan,
): number {
  const value = elementAt(cmd, index, "cmd").value;
  let consumed = 0;
  let at = 1;
  while (at < value.length) {
    const letter = value.charAt(at);
    const digits = letter === "L" ? attachedDigits(value, at + 1) : 0;
    if (letter === "R") scan.recursive = true;
    else if (digits === 0 && TREE_VALUED_LETTERS.has(letter)) {
      consumed += 1;
      recordTreeValue(letter, cmd[index + consumed]?.value, scan);
    }
    at += 1 + digits;
  }
  return consumed;
}

/** How many digits start `value` at `from`. */
function attachedDigits(value: string, from: number): number {
  return value.slice(from).match(/^\d*/)?.[0].length ?? 0;
}

function recordTreeValue(
  letter: string,
  argument: string | undefined,
  scan: TreeScan,
): void {
  if (letter === "o" && argument !== undefined) scan.outputs.push(argument);
}
