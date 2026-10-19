// Whether the text a substitution spans holds something whose end the shell's reading cannot be sure of.

import type { LexState } from "./shell-lex-state.ts";

/** The text the heredoc extractor puts in place of a body. A user may type
 *  the same text, so it is never taken as proof that a body is gone. */
const PLACEHOLDER = "<HEREDOC:sha256:";

/**
 * Whether `[from, to)` holds a heredoc placeholder, or a `$((` followed by a
 * `#` after a blank: the shell ends a `$((` that is not arithmetic at its
 * parentheses when it reads the word, but reads such a `#` as a comment when
 * it expands it. Each mark is searched for once past the last one found, so
 * the calls for one text take linear time in all.
 */
export function uncertainRegion(
  lex: LexState,
  from: number,
  to: number,
): boolean {
  lex.marks ??= [-1, -1, -1];
  const { marks } = lex;
  const text = lex.command;
  if (nextMark(marks, 0, from, () => find(text, PLACEHOLDER, from)) < to)
    return true;
  const pair = nextMark(marks, 1, from, () => find(text, "$((", from));
  if (pair >= to) return false;
  return nextMark(marks, 2, pair, () => commentFrom(text, pair)) < to;
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

/** The first `#` at or after `from` that a blank comes before. */
function commentFrom(text: string, from: number): number {
  let at = text.indexOf("#", from);
  while (at >= 0 && !/\s/.test(text.charAt(at - 1)))
    at = text.indexOf("#", at + 1);
  return at < 0 ? Number.POSITIVE_INFINITY : at;
}
