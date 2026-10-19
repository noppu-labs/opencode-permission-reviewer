// The frame steps of the substitution end-finder: how each syntax the scan can be inside reads the next character.

import type { HeredocReading, SubstitutionScan } from "./shell-lex-state.ts";
import type { PendingHeredoc } from "./shell-substitution-heredoc.ts";
import { functionHeaderEnd, type Prefix } from "./shell-substitution-prefix.ts";
import { stepCommandText } from "./shell-substitution-text.ts";
import type { Pattern, Words } from "./shell-substitution-words.ts";

/** The syntax the scan is inside: a command list (`$(`, `(`), a `case`
 *  body, a double-quoted string, or a backtick body. */
type Frame =
  | "command"
  | "case"
  | "double"
  | "backtick"
  | "brace"
  | "array"
  | "arith"
  | "test";

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
  /** The `case` or `for` header the scan is in, if any. */
  words: Words | undefined;
  /** In a `case` body, whether the next word is a pattern: after the `in`
   *  or a `;;`, until the pattern's `)`. `paren` when the pattern began with
   *  a `(`, where `esac` is a pattern too. */
  pattern: Pattern;
  /** The `words` and `pattern` of each enclosing frame, restored when an
   *  inner frame closes. */
  saved: [Words | undefined, Pattern][];
  /** Index right after the last backslash escape. */
  escapedEnd: number;
  /** Characters an arithmetic probe may still read ahead. */
  lookahead: number;
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
  scan.saved.push([scan.words, scan.pattern]);
  scan.words = undefined;
  scan.pattern = undefined;
  scan.index += width;
  scan.commandPosition = true;
  return false;
}

export function close(scan: BodyScan): boolean {
  scan.frames.pop();
  const began = scan.starts.pop();
  if (began !== undefined) scan.closes?.set(began, scan.index);
  [scan.words, scan.pattern] = scan.saved.pop() ?? [undefined, undefined];
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
  if (c === ")" || c === "(") return stepParenthesis(scan, c, insideCase);
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

/** A `)` ends a `case` pattern or closes a frame; a `(` opens a subshell,
 *  or is the optional one before a pattern. */
function stepParenthesis(
  scan: BodyScan,
  c: string,
  insideCase: boolean,
): boolean {
  if (c === "(" && insideCase && scan.pattern) {
    scan.pattern = "paren";
    return advance(scan);
  }
  if (c === "(") return openParenthesis(scan);
  if (!insideCase) return close(scan);
  scan.commandPosition = true;
  scan.pattern = undefined;
  return advance(scan);
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
