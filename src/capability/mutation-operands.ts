// Source and destination operands of the cp/mv/ln/rsync/rename file-mutation tools.

import { elementAt } from "../element-at.ts";
import { MUTATION_VALUE_OPTIONS } from "./bash-command-tables.ts";

/** A remote operand for rsync-style tools: a URL scheme, or an `host:path`
 *  / `user@host:path` shape whose part before the colon is a bare host (no
 *  slash), which is exactly how rsync decides local-with-colon vs remote. */
export function isRemoteMutationOperand(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) return true;
  const colon = value.indexOf(":");
  return colon > 0 && !value.slice(0, colon).includes("/");
}

/** Split a cp/mv/ln/rsync invocation into read sources and write
 *  destinations. The last positional operand is the destination (cp/mv/rsync
 *  destination, ln link name); `--target-directory`/`-t` names an additional
 *  destination directory everything lands under. Paths after `--` are
 *  operands like any other. */
export function mutationOperands(
  base: string,
  cmd: ReadonlyArray<{ value: string }>,
): { sources: string[]; destinations: string[]; sawOperand: boolean } {
  const valueOpts = MUTATION_VALUE_OPTIONS[base] ?? new Set<string>();
  const { operands, targetDirectory } = scanMutationArguments(cmd, valueOpts);
  if (targetDirectory !== undefined) {
    // `-t DIR` redirects every SOURCE argument into DIR: with it, no operand
    // is itself a destination.
    return {
      sources: operands,
      destinations: [targetDirectory],
      sawOperand: operands.length > 0,
    };
  }
  if (base === "rename") {
    // rename rewrites each named file, rather than copying to the last
    // operand. Keep every operand as a possible mutation across dialects.
    return {
      sources: [],
      destinations: operands,
      sawOperand: operands.length > 0,
    };
  }
  if (base === "ln" && operands.length === 1) {
    return { sources: operands, destinations: ["."], sawOperand: true };
  }
  const destinations: string[] = [];
  const lastOperand = operands.at(-1);
  if (lastOperand !== undefined) destinations.push(lastOperand);
  const sources = operands.length > 1 ? operands.slice(0, -1) : [];
  return { sources, destinations, sawOperand: operands.length > 0 };
}

/** The positional operands of a mutation command and the last
 *  `--target-directory`/`-t` value seen. */
interface MutationArguments {
  operands: string[];
  targetDirectory: string | undefined;
}

function scanMutationArguments(
  cmd: ReadonlyArray<{ value: string }>,
  valueOpts: ReadonlySet<string>,
): MutationArguments {
  const scan: MutationArguments = { operands: [], targetDirectory: undefined };
  for (let i = 1; i < cmd.length; i += 1)
    i = scanArgument(cmd, i, valueOpts, scan);
  return scan;
}

/** Apply the word at `i`; returns the index of the last word it consumed. */
function scanArgument(
  cmd: ReadonlyArray<{ value: string }>,
  i: number,
  valueOpts: ReadonlySet<string>,
  scan: MutationArguments,
): number {
  const v = elementAt(cmd, i, "cmd").value;
  if (v === "--") {
    // Every word after the first `--` is an operand, `--` included.
    for (const token of cmd.slice(i + 1)) scan.operands.push(token.value);
    return cmd.length;
  }
  if (v.startsWith("--")) return scanLongOption(cmd, i, v, valueOpts, scan);
  if (v.startsWith("-") && v.length > 1)
    return scanShortOptions(cmd, i, v, valueOpts, scan);
  scan.operands.push(v);
  return i;
}

function scanLongOption(
  cmd: ReadonlyArray<{ value: string }>,
  i: number,
  v: string,
  valueOpts: ReadonlySet<string>,
  scan: MutationArguments,
): number {
  if (valueOpts.has(v)) {
    if (v === "--target-directory") scan.targetDirectory = cmd[i + 1]?.value;
    return i + 1;
  }
  if (
    valueOpts.has("--target-directory") &&
    v.startsWith("--target-directory=")
  ) {
    scan.targetDirectory = v.slice("--target-directory=".length);
  }
  return i;
}

/** The first value-taking option in a short cluster ends it and takes the
 *  attached rest or, when nothing is attached, the next word. */
function scanShortOptions(
  cmd: ReadonlyArray<{ value: string }>,
  i: number,
  v: string,
  valueOpts: ReadonlySet<string>,
  scan: MutationArguments,
): number {
  for (let position = 1; position < v.length; position += 1) {
    const option = `-${v.charAt(position)}`;
    if (!valueOpts.has(option)) continue;
    const attached = v.slice(position + 1);
    const last = attached ? i : i + 1;
    if (option === "-t") scan.targetDirectory = attached || cmd[last]?.value;
    return last;
  }
  return i;
}
