// Constructs whose words are never commands: an array literal, a `[[ ]]` test and an arithmetic command.

import {
  advance,
  type BodyScan,
  close,
  open,
  stepCommand,
} from "./shell-substitution-frames.ts";
import { closesAsArithmetic } from "./shell-substitution-pairs.ts";

/**
 * Opens the group that the `(` or `[` at the scan starts, if it starts one:
 * `x=(`, a `[[` at a command position, a `((` the shell pairs as arithmetic,
 * and any `$((`, which the shell reads as one pair. Returns undefined when
 * it starts none.
 */
export function openGroup(scan: BodyScan, c: string): boolean | undefined {
  const { text, index } = scan;
  if (c === "[") return openTest(scan);
  if (text[index - 1] === "=") return openArray(scan);
  if (text[index + 1] !== "(") return undefined;
  const dollar = text[index - 1] === "$";
  if (!scan.commandPosition && !dollar && scan.words !== "forName")
    return undefined;
  if (!dollar && !closesAsArithmetic(text, index, scan.probes))
    return undefined;
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

/** The text of an arithmetic command or of a `$((`: its parentheses nest,
 *  nothing in it is a command, and a `${` that is no `${ command; }` is
 *  text, so a `)` in it pairs. */
export function stepArith(scan: BodyScan, c: string): boolean {
  if (c === "#" || c === "<" || c === ">") return advance(scan);
  if (c === "$" && plainBrace(scan.text, scan.index)) return advance(scan);
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

function plainBrace(text: string, index: number): boolean {
  return text[index + 1] === "{" && !/[\s|]/.test(text.charAt(index + 2));
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
    (index + 2 >= text.length || /[\s;&|)<>]/.test(text.charAt(index + 2)))
  );
}
