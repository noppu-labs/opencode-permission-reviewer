// Constructs whose words are never commands: an array literal, a `[[ ]]` test and an arithmetic command.

import {
  advance,
  type BodyScan,
  close,
  open,
  stepCommand,
} from "./shell-substitution-frames.ts";

/**
 * Opens the group that the `(` or `[` at the scan starts, if it starts one:
 * `x=(`, a `[[` at a command position, and `((` or `$((` that closes with
 * `))`. Returns undefined when it starts none.
 */
export function openGroup(scan: BodyScan, c: string): boolean | undefined {
  const { text, index } = scan;
  if (c === "[") return openTest(scan);
  if (text[index - 1] === "=") return openArray(scan);
  if (text[index + 1] !== "(") return undefined;
  const dollar = text[index - 1] === "$";
  if (!scan.commandPosition && !dollar && scan.words !== "forName")
    return undefined;
  const end = arithmeticEnd(scan);
  if (end < 0) return undefined;
  const forLoop = scan.words === "forName";
  open(scan, "arith", 1);
  open(scan, "arith", 1);
  scan.commandPosition = false;
  if (forLoop) scan.saved[scan.saved.length - 2] = ["forAfterName", undefined];
  return false;
}

function openArray(scan: BodyScan): boolean {
  open(scan, "array", 1);
  scan.commandPosition = false;
  return false;
}

function openTest(scan: BodyScan): boolean | undefined {
  const { text, index } = scan;
  if (!scan.commandPosition || !text.startsWith("[[", index)) return undefined;
  if (!/\s/.test(text.charAt(index + 2))) return undefined;
  open(scan, "test", 2);
  scan.commandPosition = false;
  return false;
}

/** The index of the `))` that closes the `((` at the scan, or -1 when the
 *  first unmatched `)` is not followed by another, or when the text runs
 *  out. Quotes are skipped. The text read is charged to a budget, so a run
 *  of `((` that never close costs a bounded amount in all. */
function arithmeticEnd(scan: BodyScan): number {
  const limit = Math.min(scan.text.length, scan.index + scan.lookahead);
  const { end, stop } = matchEnd(scan.text, scan.index + 2, limit);
  scan.lookahead -= Math.max(0, stop - scan.index);
  return end;
}

function matchEnd(
  text: string,
  from: number,
  limit: number,
): { end: number; stop: number } {
  let depth = 0;
  let i = from;
  while (i < limit) {
    const c = text.charAt(i);
    if (c === ")" && depth === 0)
      return { end: text[i + 1] === ")" ? i : -1, stop: i };
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    i = skipQuoted(text, i, limit);
  }
  return { end: -1, stop: i };
}

/** The index after the character at `from`, or after the escape or quoted
 *  string that starts there. */
function skipQuoted(text: string, from: number, limit: number): number {
  const c = text.charAt(from);
  if (c === "\\") return from + 2;
  if (c !== "'" && c !== '"' && c !== "`") return from + 1;
  let i = from + 1;
  while (i < limit && text[i] !== c) i += c !== "'" && text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** The text of an arithmetic command: its parentheses nest, and nothing in
 *  it is a command. */
export function stepArith(scan: BodyScan, c: string): boolean {
  if (c === "#") return advance(scan);
  const group = c === "(" ? openGroup(scan, c) : undefined;
  if (group !== undefined) return group;
  if (c === "(" && scan.text[scan.index - 1] !== "$") {
    open(scan, "arith", 1);
    scan.commandPosition = false;
    return false;
  }
  const done = stepCommand(scan, c, false);
  if (scan.frames.at(-1) === "arith") scan.commandPosition = false;
  return done;
}

/** The text of an array literal: nothing in it is a command. */
export function stepArray(scan: BodyScan, c: string): boolean {
  const done = stepCommand(scan, c, false);
  if (scan.frames.at(-1) === "array") scan.commandPosition = false;
  return done;
}

/** The text of a `[[ … ]]` test: its parentheses group tests or hold
 *  patterns, and it ends at a `]]` word. */
export function stepTest(scan: BodyScan, c: string): boolean {
  if (c === "]" && endsTest(scan)) {
    scan.index += 1;
    return close(scan);
  }
  const prior = scan.text.charAt(scan.index - 1);
  if (c === "#" && !/\s/.test(prior)) return advance(scan);
  if ((c === "(" || c === ")") && prior !== "$") return advance(scan);
  const done = stepCommand(scan, c, false);
  if (scan.frames.at(-1) === "test") scan.commandPosition = false;
  return done;
}

function endsTest(scan: BodyScan): boolean {
  const { text, index } = scan;
  return (
    text.startsWith("]]", index) &&
    /\s/.test(text.charAt(index - 1)) &&
    (index + 2 >= text.length || /[\s;&|)]/.test(text.charAt(index + 2)))
  );
}
