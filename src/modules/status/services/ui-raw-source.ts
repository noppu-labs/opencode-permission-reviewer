// Where a lexed token, separator or parenthesis sits in the command it came
// from, so display segments can be built from the source text and keep its
// spacing. Server only, next to the segment builder.

/** `next` is where the search for the following item starts. It differs
 *  from `end` only for a line break the lexer reports as `;`, which has no
 *  width (`start === end`). */
export interface SourceSpan {
  start: number;
  end: number;
  next: number;
}

/** The display puts a space beside a separator, which the shell ignores
 *  unless the neighbour is one of these. */
const OPERATOR_CHARS = /[<>|&;]/;

function spanOf(source: string, text: string, from: number): SourceSpan[] {
  const start = text === "" ? -1 : source.indexOf(text, from);
  if (start === -1) return [];
  const end = start + text.length;
  return [{ start, end, next: end }];
}

const earliest = (spans: readonly SourceSpan[]): SourceSpan | undefined =>
  spans.reduce<SourceSpan | undefined>(
    (best: SourceSpan | undefined, span: SourceSpan): SourceSpan =>
      best === undefined || span.start < best.start ? span : best,
    undefined,
  );

/** Where the token lexed as `raw` sits at or after `from`. The token's
 *  raw text is its source, so it is located directly. */
export function locateToken(
  source: string,
  raw: string,
  from: number,
): SourceSpan | undefined {
  return spanOf(source, raw, from)[0];
}

/** Where a separator or parenthesis sits at or after `from`. A `;` is a
 *  semicolon or a line break, whichever comes first. */
export function locateSeparator(
  source: string,
  separator: string,
  from: number,
): SourceSpan | undefined {
  const spans = spanOf(source, separator, from);
  if (separator !== ";") return spans[0];
  const breaks = ["\n", "\r"].flatMap((lineBreak: string): SourceSpan[] =>
    spanOf(source, lineBreak, from).map(
      (span: SourceSpan): SourceSpan => ({ ...span, end: span.start }),
    ),
  );
  return earliest([...spans, ...breaks]);
}

/** Where the text the shell skips at `index` ends: a space or tab, a line
 *  continuation, a line break when `lineBreaks`, or a `#` comment that
 *  starts a word and ends by `to`. Undefined for anything else. */
function skipped(
  source: string,
  index: number,
  to: number,
  lineBreaks: boolean,
): number | undefined {
  const c = source.charAt(index);
  if (c === " " || c === "\t") return index + 1;
  if (c === "\\" && source.charAt(index + 1) === "\n") return index + 2;
  if (c === "\n") return lineBreaks ? index + 1 : undefined;
  if (c !== "#" || !/^$|[ \t\n]/.test(source.charAt(index - 1)))
    return undefined;
  const lineEnd = source.indexOf("\n", index);
  const end = lineEnd === -1 ? source.length : lineEnd;
  return end <= to ? end : undefined;
}

/** Whether the shell skips all of `source` from `from` to `to`. */
export function onlySkipped(
  source: string,
  from: number,
  to: number,
  lineBreaks: boolean,
): boolean {
  for (let index = from; index < to; ) {
    const next = skipped(source, index, to, lineBreaks);
    if (next === undefined) return false;
    index = next;
  }
  return true;
}

/** Whether the separator at `span` touches an operator character. */
export function touchesOperator(source: string, span: SourceSpan): boolean {
  return (
    span.start < span.end &&
    (OPERATOR_CHARS.test(source.charAt(span.start - 1)) ||
      OPERATOR_CHARS.test(source.charAt(span.end)))
  );
}
