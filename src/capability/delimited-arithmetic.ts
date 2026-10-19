// Whether bash 3.2 reads a `$((` in a heredoc body as arithmetic, settled from the parenthesis ends a scan of the body already found where it can be.

import {
  type DelimitedCloses,
  readsAsArithmetic,
} from "./delimited-substitution-end.ts";

/** One body's text, the parenthesis ends its scans found, and how many
 *  characters before each index read differently when the shell checks an
 *  arithmetic text than when it ends a substitution, built when first
 *  needed. */
export interface ArithmeticReads {
  text: string;
  closes: DelimitedCloses;
  differs: Int32Array | undefined;
}

/** A backtick, a `#` and the escape byte: the arithmetic check reads them as
 *  plain characters, the end-finder does not. */
function readsDifferently(c: string): boolean {
  return c === "`" || c === "#" || c === "\x01";
}

/**
 * Whether bash 3.2 reads the `$((` at `index`, whose `$(` ends at the `)` at
 * `close`, as arithmetic: its text must end with `)` and balance its
 * parentheses before that. Where that text holds no character that reads
 * differently, it balances exactly when the end-finder closes its inner `(`
 * right before `close`, which the kept ends tell at once. Otherwise the text
 * is checked in full, its length charged through `charge` first.
 */
export function readsAsArithmeticAt(
  reads: ArithmeticReads,
  index: number,
  close: number,
  charge: (chars: number) => boolean,
): boolean {
  const { text } = reads;
  if (text.charAt(close - 1) !== ")") return false;
  const inner = reads.closes.get(index + 3);
  if (inner !== undefined && !differsBetween(reads, index + 3, close - 1))
    return inner === close - 1;
  return (
    charge(close - index) && readsAsArithmetic(text.slice(index + 3, close))
  );
}

function differsBetween(
  reads: ArithmeticReads,
  from: number,
  to: number,
): boolean {
  reads.differs ??= countDiffering(reads.text);
  return (reads.differs[to] ?? 0) - (reads.differs[from] ?? 0) > 0;
}

function countDiffering(text: string): Int32Array {
  const counts = new Int32Array(text.length + 1);
  for (let index = 0; index < text.length; index += 1)
    counts[index + 1] =
      (counts[index] ?? 0) + (readsDifferently(text.charAt(index)) ? 1 : 0);
  return counts;
}
