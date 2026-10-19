// Constructs whose words are never commands: an array literal, a `[[ ]]` test and an arithmetic command.

import type { ParenTable, ProbeCache } from "./shell-lex-state.ts";
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
  if (!isArithmetic(scan)) return undefined;
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

/** Whether the `((` at the scan is arithmetic: it closes with `))`, and
 *  nothing in between is quoted or escaped, so that a quoted parenthesis
 *  cannot have paired with it. The parentheses of the whole text are matched
 *  once, so the answer is a function of the text after the `((` alone and no
 *  `((` is read twice. */
function isArithmetic(scan: BodyScan): boolean {
  const { text, index } = scan;
  const { matches, quotes } = parenTable(text, scan.probes);
  const closer = matches[index + 1] ?? -1;
  if (closer < 0 || text[closer + 1] !== ")") return false;
  return (quotes[closer] ?? 0) === (quotes[index + 2] ?? 0);
}

/** The parentheses of `text`, matched in one pass. Every parenthesis counts;
 *  a `)` with no `(` open is ignored. */
function parenTable(text: string, cache: ProbeCache): ParenTable {
  const known = cache.parenTables?.get(text);
  if (known !== undefined) return known;
  const matches = new Int32Array(text.length).fill(-1);
  const quotes = new Int32Array(text.length + 1);
  const open = new Int32Array(text.length);
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    quotes[i + 1] = (quotes[i] ?? 0) + (QUOTING.has(code) ? 1 : 0);
    if (code === 40) open[depth++] = i;
    else if (code === 41 && depth > 0) matches[open[--depth] ?? 0] = i;
  }
  const table = { matches, quotes };
  cache.parenTables ??= new Map();
  cache.parenTables.set(text, table);
  return table;
}

/** `'`, `"`, a backtick and a backslash. */
const QUOTING = new Set([39, 34, 96, 92]);

/** The text of an arithmetic command: its parentheses nest, and nothing in
 *  it is a command. */
export function stepArith(scan: BodyScan, c: string): boolean {
  if (c === "#" || c === "<" || c === ">") return advance(scan);
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
    (index + 2 >= text.length || /[\s;&|)<>]/.test(text.charAt(index + 2)))
  );
}
