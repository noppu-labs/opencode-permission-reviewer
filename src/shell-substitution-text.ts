// How the substitution end-finder reads the text of a command list: newlines, comments, heredoc operators, words and separators.

import type { BodyScan } from "./shell-substitution-frames.ts";
import {
  heredocBodiesEnd,
  heredocOperatorAt,
} from "./shell-substitution-heredoc.ts";
import { stepPrefixText } from "./shell-substitution-prefix.ts";
import { endHeader, readWord } from "./shell-substitution-words.ts";

export function stepCommandText(scan: BodyScan, c: string): void {
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
  if (";&|".includes(c)) stepSeparator(scan, c);
  else if (!" \t{!".includes(c)) scan.commandPosition = false;
  scan.index += 1;
}

function stepSeparator(scan: BodyScan, c: string): void {
  scan.commandPosition = true;
  scan.prefix = undefined;
  endHeader(scan);
  if (c === ";" && scan.mode === "bash") caseTerminator(scan);
}

function atWordStart(scan: BodyScan): boolean {
  const { text, index } = scan;
  if (scan.mode === "bash" && scan.escapedEnd === index)
    return afterContinuation(text, index);
  return /[\s;&|()]/.test(text.charAt(index - 1));
}

/** Whether the text right before `index`, once the backslash-newlines that
 *  join lines are taken out, ends where a word does. An escaped character
 *  that is not a newline is part of its word. */
function afterContinuation(text: string, index: number): boolean {
  if (text.charAt(index - 1) !== "\n") return false;
  let at = index - 2;
  while (text[at - 1] === "\n" && text[at - 2] === "\\") at -= 2;
  if (at === 0) return true;
  let slashes = 0;
  while (text[at - 2 - slashes] === "\\") slashes += 1;
  return slashes % 2 === 0 && /[\s;&|()]/.test(text.charAt(at - 1));
}

/** In a `case` body, `;;`, `;&` and `;;&` end a clause: patterns follow. */
function caseTerminator(scan: BodyScan): void {
  if (scan.frames.at(-1) !== "case") return;
  const next = scan.text[scan.index + 1];
  if (next !== ";" && next !== "&") return;
  scan.pattern = "bare";
  scan.index += next === ";" && scan.text[scan.index + 2] === "&" ? 2 : 1;
}

/** A newline ends the line the pending heredocs started on: their bodies
 *  follow and are skipped whole. */
function skipNewline(scan: BodyScan): void {
  endHeader(scan);
  scan.index = heredocBodiesEnd(
    scan.text,
    scan.index + 1,
    scan.heredocs,
    scan.mode === "bash",
  );
  scan.heredocs = [];
  scan.commandPosition = true;
}

function readHeredocOperator(scan: BodyScan): void {
  const operator = heredocOperatorAt(scan.text, scan.index, scan.reading);
  if (operator.heredoc !== undefined) scan.heredocs.push(operator.heredoc);
  scan.index = operator.end;
  scan.commandPosition = false;
}
