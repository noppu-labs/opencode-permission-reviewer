// Words that leave the next word at a command position (`time`, `coproc`, a function's header), as bash reads them.

import type { BodyScan } from "./shell-substitution-frames.ts";

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
/** What the previous word asked of the next one. */
export type Prefix = "time" | "coproc" | "function";

/** After a `coproc` name, the start of the compound command it runs. */
const COMPOUND_START =
  /[ \t]+(?:(?:case|if|while|until|for|select)(?!\w)|\{|\(|\[\[)/y;
const TIME_OPTION = /(?:-p|--)(?=[ \t\n]|$)/y;
const HEADER = /\([ \t]*\)/y;
/** A character that ends a function name, and one that cannot start it. */
const NAME_BREAK = /[\s|&;()<>$`"'\\]/;
const NAME_START = /[^\s|&;()<>$`"'\\{!#]/;

/** A word: `case` at a command position opens a `case` body, `esac`
 *  closes the innermost one. */
export function readWord(scan: BodyScan): void {
  let end = scan.index;
  while (/\w/.test(scan.text.charAt(end))) end += 1;
  const word = scan.text.slice(scan.index, end);
  const atCommand = scan.commandPosition;
  if (atCommand && word === "case") scan.frames.push("case");
  else if (atCommand && word === "esac" && scan.frames.at(-1) === "case")
    scan.frames.pop();
  scan.commandPosition =
    COMMAND_PREFIX_WORDS.has(word) ||
    (scan.mode === "bash" && keepsCommandPosition(scan, word, scan.index, end));
  if (atCommand) scan.headStart = scan.index;
  scan.index = end;
}

/**
 * Whether the word read at `start` keeps the next word at a command
 * position, and what it asks of that word: `time` (unless it follows a
 * pipe) and `coproc` with its name.
 */
function keepsCommandPosition(
  scan: BodyScan,
  word: string,
  start: number,
  end: number,
): boolean {
  const pending = scan.prefix;
  scan.prefix = undefined;
  if (!scan.commandPosition) return false;
  if (pending === "coproc") {
    COMPOUND_START.lastIndex = end;
    return COMPOUND_START.test(scan.text);
  }
  if (word === "time" && !followsPipe(scan.text, start)) scan.prefix = "time";
  else if (word === "coproc" || word === "function") scan.prefix = word;
  return scan.prefix !== undefined;
}

function followsPipe(text: string, start: number): boolean {
  let i = start - 1;
  while (text[i] === " " || text[i] === "\t") i -= 1;
  if (text[i] === "&" && text[i - 1] === "|") return true;
  return text[i] === "|" && text[i - 1] !== "|";
}

/** The end of a `-p` or `--` after `time`, or -1. */
function timeOptionEnd(scan: BodyScan): number {
  if (scan.prefix !== "time") return -1;
  TIME_OPTION.lastIndex = scan.index;
  return TIME_OPTION.test(scan.text) ? TIME_OPTION.lastIndex : -1;
}

/** Text the scan reads here as a word of its own: the option after `time`,
 *  the name after `function`, or the start of a command word that is not
 *  made of word characters (`-a`, `.x`), which can name a function. */
export function stepPrefixText(scan: BodyScan, c: string): boolean {
  const optionEnd = c === "-" ? timeOptionEnd(scan) : -1;
  if (optionEnd >= 0) {
    scan.index = optionEnd;
    return true;
  }
  if (scan.mode !== "bash" || !NAME_START.test(c)) return false;
  if (scan.prefix === "function") {
    scan.headStart = scan.index;
    scan.index = nameEnd(scan.text, scan.index);
    scan.prefix = undefined;
    scan.commandPosition = true;
    return true;
  }
  if (scan.commandPosition && !/\w/.test(c)) scan.headStart = scan.index;
  return false;
}

/** The end of the run of characters that can make up a function's name. */
function nameEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && !NAME_BREAK.test(text.charAt(i))) i += 1;
  return i;
}

/** The end of the `()` of a function header `name ()` at the scan, or -1. */
export function functionHeaderEnd(scan: BodyScan): number {
  if (scan.headStart < 0) return -1;
  let i = nameEnd(scan.text, scan.headStart);
  while (scan.text[i] === " " || scan.text[i] === "\t") i += 1;
  if (i !== scan.index) return -1;
  HEADER.lastIndex = scan.index;
  return HEADER.test(scan.text) ? HEADER.lastIndex : -1;
}
