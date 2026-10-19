// The frame steps of the substitution end-finder: how each syntax the scan can be inside reads the next character.

import type { HeredocReading, SubstitutionScan } from "./shell-lex-state.ts";
import {
  heredocBodiesEnd,
  heredocOperatorAt,
  type PendingHeredoc,
} from "./shell-substitution-heredoc.ts";
import {
  functionHeaderEnd,
  type Prefix,
  readWord,
  stepPrefixText,
} from "./shell-substitution-prefix.ts";

/** The syntax the scan is inside: a command list (`$(`, `(`), a `case`
 *  body, a double-quoted string, or a backtick body. */
type Frame = "command" | "case" | "double" | "backtick" | "brace";

export interface BodyScan {
  text: string;
  index: number;
  frames: Frame[];
  /** Where each open frame began, for `closes`. */
  starts: number[];
  /** When present, the index each frame closed at, by the index it began at:
   *  the `(` or `$` that opened it. */
  closes: Map<number, number> | undefined;
  heredocs: PendingHeredoc[];
  /** Whether the next word sits where a command (or `case`/`esac`) can start. */
  commandPosition: boolean;
  reading: HeredocReading;
  mode: SubstitutionScan;
  /** What the last word asked of the next one (`time`, `coproc`, `function`). */
  prefix: Prefix | undefined;
  /** Start of the last word that began at a command position, or -1. */
  headStart: number;
}

export function advance(scan: BodyScan): boolean {
  scan.index += 1;
  return false;
}

export function open(scan: BodyScan, frame: Frame, width: number): boolean {
  scan.frames.push(frame);
  scan.starts.push(scan.index);
  scan.prefix = undefined;
  scan.headStart = -1;
  scan.index += width;
  scan.commandPosition = true;
  return false;
}

export function close(scan: BodyScan): boolean {
  scan.frames.pop();
  const began = scan.starts.pop();
  if (began !== undefined) scan.closes?.set(began, scan.index);
  if (scan.frames.length === 0) return true;
  scan.index += 1;
  scan.commandPosition = false;
  return false;
}

export function stepCommand(
  scan: BodyScan,
  c: string,
  insideCase: boolean,
): boolean {
  if (c === ")") {
    if (!insideCase) return close(scan);
    scan.commandPosition = true;
    return advance(scan);
  }
  if (c === "(") return openParenthesis(scan);
  if (c === '"') return open(scan, "double", 1);
  if (c === "`") return open(scan, "backtick", 1);
  if (c === "'" || (c === "$" && scan.text[scan.index + 1] === "'")) {
    skipSingleQuoted(scan, c === "$");
    return false;
  }
  if (c === "$" && scan.mode === "bash") return stepDollar(scan);
  stepCommandText(scan, c);
  return false;
}

/** A `(` opens a subshell, unless it is the `()` of a function header. */
function openParenthesis(scan: BodyScan): boolean {
  const end = scan.mode === "bash" ? functionHeaderEnd(scan) : -1;
  if (end < 0) return open(scan, "command", 1);
  scan.index = end;
  scan.headStart = -1;
  scan.commandPosition = true;
  return false;
}

/** `${` opens an expansion that holds a `)` as text; `$$` is one parameter. */
function stepDollar(scan: BodyScan): boolean {
  const next = scan.text[scan.index + 1];
  if (next === "{") return open(scan, "brace", 2);
  scan.commandPosition = false;
  scan.index += next === "$" ? 2 : 1;
  return false;
}

/** Skip a `'…'` string, or a `$'…'` string whose backslashes escape. */
export function skipSingleQuoted(scan: BodyScan, ansiC: boolean): void {
  const { text } = scan;
  let i = scan.index + (ansiC ? 2 : 1);
  while (i < text.length && text[i] !== "'")
    i += ansiC && text[i] === "\\" ? 2 : 1;
  scan.index = i + 1;
  scan.commandPosition = false;
}

function stepCommandText(scan: BodyScan, c: string): void {
  if (c === "\n") {
    skipNewline(scan);
    return;
  }
  if (c === "#" && atWordStart(scan)) {
    const newline = scan.text.indexOf("\n", scan.index);
    scan.index = newline === -1 ? scan.text.length : newline;
    return;
  }
  if (c === "<" && scan.text[scan.index + 1] === "<") {
    readHeredocOperator(scan);
    return;
  }
  if (stepPrefixText(scan, c)) return;
  if (/\w/.test(c)) {
    readWord(scan);
    return;
  }
  if (";&|".includes(c)) {
    scan.commandPosition = true;
    scan.prefix = undefined;
  } else if (!" \t{!".includes(c)) scan.commandPosition = false;
  scan.index += 1;
}

function atWordStart(scan: BodyScan): boolean {
  return /[\s;&|()]/.test(scan.text.charAt(scan.index - 1));
}

/** A newline ends the line the pending heredocs started on: their bodies
 *  follow and are skipped whole. */
function skipNewline(scan: BodyScan): void {
  scan.index = heredocBodiesEnd(scan.text, scan.index + 1, scan.heredocs);
  scan.heredocs = [];
  scan.commandPosition = true;
}

function readHeredocOperator(scan: BodyScan): void {
  const operator = heredocOperatorAt(scan.text, scan.index, scan.reading);
  if (operator.heredoc !== undefined) scan.heredocs.push(operator.heredoc);
  scan.index = operator.end;
  scan.commandPosition = false;
}
