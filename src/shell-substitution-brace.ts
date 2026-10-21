// How the substitution end-finder reads the text of a double-quoted string and of a `${…}` expansion, where substitutions open frames of their own.

import {
  advance,
  type BodyScan,
  close,
  open,
  skipSingleQuoted,
} from "./shell-substitution-frames.ts";

export function stepDouble(scan: BodyScan, c: string): boolean {
  return stepQuoted(scan, c, '"', false);
}

/** A `${…}` holds `"…"`, `'…'` and `$'…'` strings, in double quotes or not:
 *  a `}` inside one does not close it. */
export function stepBrace(scan: BodyScan, c: string): boolean {
  return stepQuoted(scan, c, "}", true);
}

/** It ends at `closer`; substitutions inside open frames of their own. */
function stepQuoted(
  scan: BodyScan,
  c: string,
  closer: string,
  singleQuotes: boolean,
): boolean {
  if (c === closer) return close(scan);
  if (c === '"') return open(scan, "double", 1);
  if (c === "`") return open(scan, "backtick", 1);
  if (c === "'" && singleQuotes) return skip(scan, false);
  return c === "$" ? stepDollar(scan, singleQuotes) : advance(scan);
}

/** A `$$` is one parameter, so the `$` after it does not start a `${`.
 *  The shell reads a `$((` as one arithmetic pair. */
function stepDollar(scan: BodyScan, singleQuotes: boolean): boolean {
  const next = scan.text[scan.index + 1];
  if (next !== "(") return stepParameter(scan, next, singleQuotes);
  const pair = scan.mode === "bash" && scan.text[scan.index + 2] === "(";
  return open(scan, pair ? "arith" : "command", 2);
}

function stepParameter(
  scan: BodyScan,
  next: string | undefined,
  singleQuotes: boolean,
): boolean {
  if (scan.mode !== "bash") return advance(scan);
  if (next === "{") return open(scan, "brace", 2);
  if (next === "$") scan.index += 1;
  else if (next === "'" && singleQuotes) return skip(scan, true);
  return advance(scan);
}

function skip(scan: BodyScan, ansiC: boolean): boolean {
  skipSingleQuoted(scan, ansiC);
  return false;
}
