// The frame steps of the substitution end-finder: how each syntax the scan can be inside reads the next character.

import type { HeredocReading, SubstitutionScan } from "./shell-lex-state.ts";
import {
  heredocBodiesEnd,
  heredocOperatorAt,
  type PendingHeredoc,
} from "./shell-substitution-heredoc.ts";

/** The syntax the scan is inside: a command list (`$(`, `(`), a `case`
 *  body, a double-quoted string, or a backtick body. */
type Frame = "command" | "case" | "double" | "backtick" | "brace";

export interface BodyScan {
  text: string;
  index: number;
  frames: Frame[];
  heredocs: PendingHeredoc[];
  /** Whether the next word sits where a command (or `case`/`esac`) can start. */
  commandPosition: boolean;
  reading: HeredocReading;
  mode: SubstitutionScan;
}

/** Words after which a command can still start. */
const COMMAND_PREFIX_WORDS = new Set([
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "in",
]);

export function advance(scan: BodyScan): boolean {
  scan.index += 1;
  return false;
}

function open(scan: BodyScan, frame: Frame, width: number): boolean {
  scan.frames.push(frame);
  scan.index += width;
  scan.commandPosition = true;
  return false;
}

export function close(scan: BodyScan): boolean {
  scan.frames.pop();
  if (scan.frames.length === 0) return true;
  scan.index += 1;
  scan.commandPosition = false;
  return false;
}

export function stepDouble(scan: BodyScan, c: string): boolean {
  return stepQuoted(scan, c, '"');
}

/** Inside a `${…}` in double quotes, quotes open strings of their own. */
export function stepBrace(scan: BodyScan, c: string): boolean {
  return stepQuoted(scan, c, "}");
}

/** The text of a double-quoted string or of a `${…}` inside one: it ends at
 *  `closer`, and substitutions inside it open frames of their own. */
function stepQuoted(scan: BodyScan, c: string, closer: string): boolean {
  if (c === closer) return close(scan);
  if (c === '"') return open(scan, "double", 1);
  if (c === "`") return open(scan, "backtick", 1);
  const next = c === "$" ? scan.text[scan.index + 1] : undefined;
  if (next === "(") return open(scan, "command", 2);
  if (next === "{" && scan.mode === "bash") return open(scan, "brace", 2);
  return advance(scan);
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
  if (c === "(") return open(scan, "command", 1);
  if (c === '"') return open(scan, "double", 1);
  if (c === "`") return open(scan, "backtick", 1);
  if (c === "'" || (c === "$" && scan.text[scan.index + 1] === "'")) {
    skipSingleQuoted(scan, c === "$");
    return false;
  }
  stepCommandText(scan, c);
  return false;
}

/** Skip a `'…'` string, or a `$'…'` string whose backslashes escape. */
function skipSingleQuoted(scan: BodyScan, ansiC: boolean): void {
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
  if (/\w/.test(c)) {
    readWord(scan);
    return;
  }
  if (";&|".includes(c)) scan.commandPosition = true;
  else if (!" \t{!".includes(c)) scan.commandPosition = false;
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

/** A word: `case` at a command position opens a `case` body, `esac`
 *  closes the innermost one. */
function readWord(scan: BodyScan): void {
  let end = scan.index;
  while (/\w/.test(scan.text.charAt(end))) end += 1;
  const word = scan.text.slice(scan.index, end);
  if (scan.commandPosition && word === "case") scan.frames.push("case");
  else if (
    scan.commandPosition &&
    word === "esac" &&
    scan.frames.at(-1) === "case"
  )
    scan.frames.pop();
  scan.commandPosition = COMMAND_PREFIX_WORDS.has(word);
  scan.index = end;
}
