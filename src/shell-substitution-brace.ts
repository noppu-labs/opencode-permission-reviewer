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

/** Inside a `${…}` in double quotes, quotes open strings of their own and a
 *  `'` is an ordinary character. */
export function stepBrace(scan: BodyScan, c: string): boolean {
  return stepQuoted(scan, c, "}", false);
}

/** Outside double quotes a `${…}` also holds `'…'` and `$'…'` strings. */
export function stepCommandBrace(scan: BodyScan, c: string): boolean {
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

/** A `$$` is one parameter, so the `$` after it does not start a `${`. */
function stepDollar(scan: BodyScan, singleQuotes: boolean): boolean {
  const next = scan.text[scan.index + 1];
  if (next === "(") return open(scan, "command", 2);
  if (scan.mode !== "bash") return advance(scan);
  if (next === "{") return open(scan, singleQuotes ? "cbrace" : "brace", 2);
  if (next === "$") scan.index += 1;
  else if (next === "'" && singleQuotes) return skip(scan, true);
  return advance(scan);
}

function skip(scan: BodyScan, ansiC: boolean): boolean {
  skipSingleQuoted(scan, ansiC);
  return false;
}
