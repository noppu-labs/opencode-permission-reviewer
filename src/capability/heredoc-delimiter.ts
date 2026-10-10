// The delimiter word after a heredoc operator: quote removal, ANSI-C unescaping and whether the terminator line is knowable.

import {
  scanDollarQuoted,
  scanDoubleQuoted,
  scanSingleQuoted,
  type WordScan,
} from "./heredoc-word-quotes.ts";

/** Characters that cannot appear unquoted inside a heredoc delimiter word.
 *  `$` and backticks are NOT stops: the delimiter word undergoes no
 *  expansion, so they are literal terminator characters. */
const BARE_WORD_STOP = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "|",
  "&",
  ";",
  "<",
  ">",
  "(",
  ")",
  "\\",
  "'",
  '"',
]);

interface DelimiterWord {
  /** Index just past the word. */
  wordEnd: number;
  /** Quote-removed delimiter: the line that terminates the body. */
  delimiter: string;
  /** Whether any part of the word was quoted (disables body expansion). */
  quoted: boolean;
  /** False when the word depends on shell expansion, so the terminator line
   *  is statically unknowable. */
  resolved: boolean;
}

/** Parse the delimiter word after a `<<` operator. Bash applies ONLY quote
 *  removal to the word: parameter expansion, command substitution, tilde
 *  expansion, and arithmetic never affect the terminator, because the parser
 *  must match the body's end while reading the script (verified against
 *  bash 5.2: `<<$EOF` with EOF set still terminates at the literal `$EOF`
 *  line). Supported word forms:
 *    - bare characters, including `$`, backticks, `~`: literal
 *    - `'...'`: literal, disables body expansion
 *    - `"..."` and `$"..."`: quote removal (`\$ \` \" \\` drop the
 *      backslash), disables body expansion
 *    - `$'...'`: ANSI-C unescaping, disables body expansion
 *    - `\x` outside quotes: literal `x`, disables body expansion
 *  The word is `resolved: false` only when its quoting never terminates or
 *  the word is empty: then no line can be proven to be the terminator. */
export function parseDelimiterWord(
  command: string,
  start: number,
): DelimiterWord {
  const scan: WordScan = {
    index: start,
    delimiter: "",
    quoted: false,
    resolved: true,
    sawAny: false,
  };
  while (scan.index < command.length) {
    if (!scanDelimiterPart(command, scan)) break;
  }
  if (!scan.sawAny)
    return { wordEnd: start, delimiter: "", quoted: false, resolved: false };
  return {
    wordEnd: scan.index,
    delimiter: scan.delimiter,
    quoted: scan.quoted,
    resolved: scan.resolved,
  };
}

/** Consume the word part at `scan.index`. Returns false when the word ends
 *  there: at a stop character, or at quoting that never terminates. */
function scanDelimiterPart(command: string, scan: WordScan): boolean {
  const c = command.charAt(scan.index);
  if (c === "'") return scanSingleQuoted(command, scan);
  // ANSI-C ($'...') and locale ($"...") quoting both start with `$`
  // followed by a quote; the body-expansion flag is set either way.
  if (
    c === "$" &&
    (command[scan.index + 1] === "'" || command[scan.index + 1] === '"')
  )
    return scanDollarQuoted(command, scan);
  if (c === '"') return scanDoubleQuoted(command, scan);
  if (c === "\\" && scan.index + 1 < command.length) {
    scan.delimiter += command.charAt(scan.index + 1);
    scan.quoted = true;
    scan.sawAny = true;
    scan.index += 2;
    return true;
  }
  if (BARE_WORD_STOP.has(c)) return false;
  scan.delimiter += c;
  scan.sawAny = true;
  scan.index += 1;
  return true;
}
