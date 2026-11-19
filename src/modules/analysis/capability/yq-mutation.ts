import type { ShellToken } from "../shell/shell-token.ts";
import {
  directoryFallback,
  type ReadOnlyToolMutation,
} from "./models/read-only-tool-mutation.ts";

/** yq's short flags that take a value. The value is the rest of the cluster,
 *  so a later letter is not a flag (`-oi` is output format "i"). */
const YQ_VALUED_LETTERS = "poIsf";

/** The values a Go boolean flag parses as false. */
const FALSE_VALUES = new Set(["0", "f", "F", "false", "FALSE", "False"]);

interface YqWrites {
  inPlace: boolean;
  /** `--split-exp` writes one file per result, under the current directory
   *  unless `--security-allow-write-any-path` lifts that. */
  split: boolean;
  anyPath: boolean;
}

/** yq: `-i` rewrites its file operands, and `-s` writes a file per result.
 *  For an in-place edit every non-option word, the expression included, is
 *  recorded as a write target. */
export function yqMutation(
  cmd: ShellToken[],
): ReadOnlyToolMutation | undefined {
  const writes = yqWrites(cmd);
  const writeTargets: string[] = [];
  if (writes.inPlace)
    writeTargets.push(
      ...cmd
        .slice(1)
        .map((token) => token.value)
        .filter((value) => !value.startsWith("-")),
    );
  if (writes.split) writeTargets.push(writes.anyPath ? "/" : directoryFallback);
  if (writes.inPlace && writeTargets.length === 0)
    writeTargets.push(directoryFallback);
  return writeTargets.length > 0 ? { writeTargets } : undefined;
}

/** Scan yq's flags (pflag syntax: no abbreviations, booleans may carry
 *  `=value`, short booleans cluster). */
function yqWrites(cmd: ShellToken[]): YqWrites {
  const writes: YqWrites = { inPlace: false, split: false, anyPath: false };
  for (const token of cmd.slice(1)) {
    const value = token.value;
    if (value === "--") break;
    if (value.startsWith("--")) yqLongFlag(value, writes);
    else if (value.startsWith("-")) yqShortFlags(value, writes);
  }
  return writes;
}

function yqLongFlag(value: string, writes: YqWrites): void {
  const equals = value.indexOf("=");
  const name = equals === -1 ? value : value.slice(0, equals);
  const enabled = equals === -1 || !FALSE_VALUES.has(value.slice(equals + 1));
  if (name === "--inplace") writes.inPlace ||= enabled;
  else if (name === "--split-exp" || name === "--split-exp-file")
    writes.split = true;
  else if (name === "--security-allow-write-any-path")
    writes.anyPath ||= enabled;
}

function yqShortFlags(value: string, writes: YqWrites): void {
  for (let at = 1; at < value.length; at += 1) {
    const letter = value.charAt(at);
    if (letter === "i") {
      if (yqInPlaceFlag(value, at, writes)) return;
    } else if (YQ_VALUED_LETTERS.includes(letter)) {
      writes.split ||= letter === "s";
      return;
    }
  }
}

/** Record the `-i` at `at`. pflag reads `-i=false` as the flag with a value,
 *  which ends the cluster; returns whether it did. */
function yqInPlaceFlag(value: string, at: number, writes: YqWrites): boolean {
  const inline = value.charAt(at + 1) === "=" ? value.slice(at + 2) : undefined;
  writes.inPlace ||= inline === undefined || !FALSE_VALUES.has(inline);
  return inline !== undefined;
}
