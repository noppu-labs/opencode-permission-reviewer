// Whether the text a substitution spans holds something whose end the shell's reading cannot be sure of.

import type { LexState } from "./shell-lex-state.ts";
import { afterContinuation, WORD_END } from "./shell-substitution-text.ts";

/** The text the heredoc extractor puts in place of a body. A user may type
 *  the same text, so it is never taken as proof that a body is gone. */
const PLACEHOLDER = "<HEREDOC:sha256:";

/**
 * Whether the substitution over `[from, to)` cannot be read with certainty:
 * the command holds a heredoc placeholder anywhere (a quote the heredoc
 * extractor read differently from the shell may have moved it), or the span
 * holds a `$(` and `(` (with any line continuations between them) followed
 * by a `#` that may start a comment: the shell ends a `$((` that is not
 * arithmetic at its parentheses when it reads the word, but reads such a
 * `#` as a comment when it expands it. Also any `$(` span with such a `#`
 * and a `)` before the end of that line: bash 3.2 ends a `$(` at that `)`.
 * Each mark is searched for once past the last one found, so the calls for
 * one text take linear time in all.
 */
export function uncertainRegion(
  lex: LexState,
  from: number,
  to: number,
): boolean {
  lex.marks ??= [-1, -1, -1, -1, -1];
  const { marks } = lex;
  const text = lex.command;
  if (nextMark(marks, 0, 0, () => find(text, PLACEHOLDER, 0)) < text.length)
    return true;
  const pair = nextMark(marks, 1, from, () => pairFrom(text, from));
  if (pair < to && nextMark(marks, 2, pair, () => commentFrom(text, pair)) < to)
    return true;
  const open = nextMark(marks, 3, from, () => find(text, "$(", from));
  if (open >= to) return false;
  return nextMark(marks, 4, open, () => closingComment(text, open)) < to;
}

/** The mark in `slot` at or after `from`, searched for again only when the
 *  last one found lies before `from`. */
function nextMark(
  marks: number[],
  slot: number,
  from: number,
  search: () => number,
): number {
  if ((marks[slot] ?? -1) < from) marks[slot] = search();
  return marks[slot] ?? Number.POSITIVE_INFINITY;
}

function find(text: string, needle: string, from: number): number {
  const at = text.indexOf(needle, from);
  return at < 0 ? Number.POSITIVE_INFINITY : at;
}

/** The first `$(` at or after `from` that a `(` follows, with any line
 *  continuations between them. */
function pairFrom(text: string, from: number): number {
  PAIR.lastIndex = from;
  const found = PAIR.exec(text);
  return found === null ? Number.POSITIVE_INFINITY : found.index;
}

const PAIR = /\$\((?:\\\n)*\(/g;

/** The first `#` at or after `from` that may start a comment and a `)`
 *  follows on its line. A line whose first such `#` has no `)` after it
 *  has none, so the search moves on to the next line. */
function closingComment(text: string, from: number): number {
  let at = commentFrom(text, from);
  while (at !== Number.POSITIVE_INFINITY) {
    const newline = text.indexOf("\n", at);
    const end = newline < 0 ? text.length : newline;
    if (text.slice(at, end).includes(")")) return at;
    if (newline < 0) break;
    at = commentFrom(text, newline);
  }
  return Number.POSITIVE_INFINITY;
}

/** The first `#` at or after `from` that may start a comment: where the
 *  end-finder starts one (after a blank, a separator, a parenthesis, or
 *  line continuations after one), or after `<` or `>`, where the shell
 *  does too. */
function commentFrom(text: string, from: number): number {
  let at = text.indexOf("#", from);
  while (at >= 0 && !commentStart(text, at)) at = text.indexOf("#", at + 1);
  return at < 0 ? Number.POSITIVE_INFINITY : at;
}

function commentStart(text: string, at: number): boolean {
  const before = text.charAt(at - 1);
  if (WORD_END.test(before) || before === "<" || before === ">") return true;
  return text.charAt(at - 2) === "\\" && afterContinuation(text, at);
}
