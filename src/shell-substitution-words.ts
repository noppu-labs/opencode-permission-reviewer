// How the substitution end-finder reads a word: where a `case` keyword opens a body, and which words are arguments, patterns or list items.

import type { BodyScan } from "./shell-substitution-frames.ts";
import { keepsCommandPosition } from "./shell-substitution-prefix.ts";

/** Where a `case` or `for` header is: its subject, its `in`, a `for`
 *  loop's name, and the words of its list. */
/** Whether a `case` pattern began with a `(`. */
export type Pattern = "bare" | "paren" | undefined;

export type Words =
  | "caseSubject"
  | "caseIn"
  | "forName"
  | "forAfterName"
  | "forList";

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

/** A word: `case` at a command position opens a `case` body, `esac`
 *  closes the innermost one. */
export function readWord(scan: BodyScan): void {
  let end = scan.index;
  while (/\w/.test(scan.text.charAt(end))) end += 1;
  const word = scan.text.slice(scan.index, end);
  if (scan.mode === "bash") {
    readBashWord(scan, word, end);
    return;
  }
  const atCommand = scan.commandPosition;
  if (atCommand && word === "case") scan.frames.push("case");
  else if (atCommand && word === "esac" && scan.frames.at(-1) === "case")
    scan.frames.pop();
  scan.commandPosition = COMMAND_PREFIX_WORDS.has(word);
  if (atCommand) scan.headStart = scan.index;
  scan.index = end;
}

/** A word as bash reads it: a keyword only at a command position, and not
 *  where a `case` pattern or a `for` list holds it. */
function readBashWord(scan: BodyScan, word: string, end: number): void {
  const start = scan.index;
  const atCommand = scan.commandPosition;
  const keeps = !scan.pattern && keepsCommandPosition(scan, word, start, end);
  scan.index = end;
  if (atCommand) scan.headStart = start;
  if (scan.words !== undefined) {
    inHeader(scan, word);
    return;
  }
  const keyword = atCommand && !scan.pattern;
  if (atCommand) openOrCloseBody(scan, word, keyword);
  scan.commandPosition =
    scan.words === undefined &&
    (keeps || (keyword && word !== "in" && COMMAND_PREFIX_WORDS.has(word)));
}

/** `case` opens a body, `esac` closes it, and `for` and `select` start a
 *  header whose list is not commands. */
function openOrCloseBody(scan: BodyScan, word: string, keyword: boolean): void {
  if (keyword && word === "case") openCase(scan);
  else if (word === "esac" && scan.pattern !== "paren") closeCase(scan);
  else if (keyword && (word === "for" || word === "select"))
    scan.words = "forName";
}

function openCase(scan: BodyScan): void {
  scan.frames.push("case");
  scan.words = "caseSubject";
}

function closeCase(scan: BodyScan): void {
  if (scan.frames.at(-1) !== "case") return;
  scan.frames.pop();
  scan.pattern = undefined;
}

/** A word inside a `case` or `for` header: the subject, the `in`, the name
 *  of the loop, or an item of its list. */
function inHeader(scan: BodyScan, word: string): void {
  scan.commandPosition = false;
  switch (scan.words) {
    case "caseSubject":
      scan.words = "caseIn";
      return;
    case "caseIn":
      if (word === "in") startPatterns(scan);
      return;
    case "forName":
      scan.words = "forAfterName";
      return;
    case "forAfterName":
      scan.words = word === "in" ? "forList" : undefined;
      scan.commandPosition = word === "do";
      return;
    default:
  }
}

/** The `in` of a `case`: the words that follow are patterns until a `)`. */
function startPatterns(scan: BodyScan): void {
  scan.words = undefined;
  scan.pattern = "bare";
  scan.commandPosition = true;
}

/** A `;`, `&`, `|` or newline ends a `for` header's list. */
export function endHeader(scan: BodyScan): void {
  const { words } = scan;
  if (words === "forName" || words === "forAfterName" || words === "forList")
    scan.words = undefined;
}

/** The first character of a `case` subject that is not a word: it is the
 *  subject, and the `in` follows. */
export function startsSubject(scan: BodyScan, c: string): void {
  if (scan.words === "caseSubject" && !/[\s\w]/.test(c)) scan.words = "caseIn";
}
