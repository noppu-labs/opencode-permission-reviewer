// Whether bash 3.2 reads a `$((` in a heredoc body as arithmetic, settled from the parenthesis ends one scan of the body keeps for the nested ones.

import {
  arithmeticCountEnd,
  type DelimitedCloses,
  doubleQuoteEnd,
} from "./delimited-substitution-end.ts";

/** One body's text, and where each parenthesis the arithmetic check counts
 *  in it closes, by the index its text starts at. */
export interface ArithmeticReads {
  text: string;
  counts: DelimitedCloses;
}

/**
 * Whether bash 3.2 reads the `$((` at `index`, whose `$(` ends at the `)` at
 * `close`, as arithmetic: its text must end with `)` and balance its
 * parentheses before that. The check's own reading of the inner `(` tells it
 * at once: closing right before `close` balances, closing earlier does not.
 * A scan settles every nested `(` it opens, so a nest is read once, and only
 * a first read is charged. Where the inner `(` closes past `close`, or not
 * at all, the text is checked on its own, its length charged first.
 */
export function readsAsArithmeticAt(
  reads: ArithmeticReads,
  index: number,
  close: number,
  charge: (chars: number) => boolean,
): boolean {
  const { text } = reads;
  if (text.charAt(close - 1) !== ")") return false;
  const start = index + 3;
  const fresh = !reads.counts.has(start);
  const end = arithmeticCountEnd(text, start, reads.counts);
  if (fresh && !charge((end < 0 ? text.length : end) - index)) return false;
  if (end === close - 1) return true;
  if (end >= 0 && end < close - 1) return false;
  return charge(close - index) && readsAsArithmetic(text.slice(start, close));
}

/**
 * Whether bash 3.2 reads the `$((` whose text after `$((` up to its closing
 * `)` is `inner` as arithmetic: it must end with `)`, and the parentheses
 * before that must balance outside quotes. Otherwise it runs the text after
 * `$(` as a command.
 */
function readsAsArithmetic(inner: string): boolean {
  if (!inner.endsWith(")")) return false;
  const text = inner.slice(0, -1);
  let open = 0;
  let index = 0;
  while (index < text.length && open >= 0) {
    const c = text.charAt(index);
    if (c === "(") open += 1;
    if (c === ")") open -= 1;
    index = pastArithmeticChar(text, index, c);
  }
  return open === 0;
}

function pastArithmeticChar(text: string, index: number, c: string): number {
  if (c === "\\") return index + 2;
  if (c === "'") {
    const end = text.indexOf("'", index + 1);
    return end < 0 ? text.length : end + 1;
  }
  if (c !== '"') return index + 1;
  const end = doubleQuoteEnd(text, index + 1);
  return end < 0 ? text.length : end;
}
