// Shell token and segment shapes, and the quote-span queries every consumer of them shares.

export interface ShellToken {
  /** Original text including any surrounding quotes. */
  raw: string;
  /** Unquoted/normalized value used for comparisons. */
  value: string;
  /** Value split into spans by quoting: every character of `value` appears
   *  in exactly one span, marked `quoted` when it came from inside quotes
   *  or from a backslash escape. An operator character (`>`, `*`, …) only
   *  acts as an operator while it sits in an UNQUOTED span: a glued, partly
   *  quoted `>"/dev/sda"` still redirects, while `'>/dev/sda'` is data. */
  spans?: Array<{ text: string; quoted: boolean }>;
}

export interface ShellSegment {
  tokens: ShellToken[];
  /** Separator that terminated this segment (`;`, `|`, `||`, `&`, `&&`, `(`,
   *  `)`). Newlines and carriage returns are reported as `;`. Absent for the
   *  final segment when the command does not end with a separator. A segment
   *  with no tokens and `endedBy` `(` or `)` is a paren marker: it exists so
   *  grouping events are never lost, and carries no command of its own. */
  endedBy?: string;
  /** The last separator seen before this segment's first token, counting
   *  separators whose (empty) segment was dropped: in `( a ) | b`, segment
   *  `b` ended up after a dropped empty segment, so its separator lineage is
   *  `)` and then `|`, and `precededBy` reports `|`. Absent for the first
   *  segment. */
  precededBy?: string;
}

/** Whether the character at `index` of `token.value` lies in a quoted or
 *  escaped span, where it cannot act as a shell operator. Tokens without
 *  span information fall back to whole-token conservatism. */
export function tokenCharIsQuoted(token: ShellToken, index: number): boolean {
  const spans = token.spans;
  if (spans === undefined) return token.raw !== token.value;
  let offset = 0;
  for (const span of spans) {
    if (index < offset + span.text.length) return span.quoted;
    offset += span.text.length;
  }
  return false;
}

/** A token's spans with the offset in `value` where each one starts, so a
 *  slice can find its first span by binary search. */
export interface SpanIndex {
  spans: Array<{ text: string; quoted: boolean }>;
  starts: number[];
}

export function indexSpans(token: ShellToken): SpanIndex {
  const spans = token.spans ?? [
    { text: token.value, quoted: token.raw !== token.value },
  ];
  const starts: number[] = [];
  let offset = 0;
  for (const span of spans) {
    starts.push(offset);
    offset += span.text.length;
  }
  return { spans, starts };
}

/** Return a token slice while preserving quote provenance for each character. */
export function sliceToken(
  token: ShellToken,
  start: number,
  end = token.value.length,
): ShellToken {
  return sliceIndexed(token, indexSpans(token), start, end);
}

/** `sliceToken` over an index built once for the token, so slicing it in a
 *  loop costs the spans each slice covers, not every span each time. */
export function sliceIndexed(
  token: ShellToken,
  index: SpanIndex,
  start: number,
  end = token.value.length,
): ShellToken {
  const value = token.value.slice(start, end);
  const spans: Array<{ text: string; quoted: boolean }> = [];
  for (
    let i = firstSpanEndingAfter(index, start);
    i < index.spans.length && (index.starts[i] ?? 0) < end;
    i += 1
  )
    pushSlicePiece(spans, index, i, start, end);
  return { raw: value, value, spans };
}

/** Span ends never decrease, so the first span ending after `start` is a
 *  binary search away; every span before it lies wholly before the slice. */
function firstSpanEndingAfter(index: SpanIndex, start: number): number {
  let low = 0;
  let high = index.spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const ends =
      (index.starts[middle] ?? 0) + (index.spans[middle]?.text.length ?? 0);
    if (ends > start) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Append the part of span `i` that falls inside `[start, end)`, merging it
 *  into the previous span when the quoting matches. */
function pushSlicePiece(
  spans: Array<{ text: string; quoted: boolean }>,
  index: SpanIndex,
  i: number,
  start: number,
  end: number,
): void {
  const span = index.spans[i];
  if (span === undefined) return;
  const spanStart = index.starts[i] ?? 0;
  const from = Math.max(start, spanStart);
  const to = Math.min(end, spanStart + span.text.length);
  if (from >= to) return;
  const text = span.text.slice(from - spanStart, to - spanStart);
  const previous = spans.at(-1);
  if (previous?.quoted === span.quoted) previous.text += text;
  else spans.push({ text, quoted: span.quoted });
}

/** `tokenCharIsQuoted` for every character of `token.value`, in one pass. */
export function quotedChars(token: ShellToken): boolean[] {
  const quoted: boolean[] = [];
  const spans = token.spans ?? [
    { text: token.value, quoted: token.raw !== token.value },
  ];
  for (const span of spans) {
    for (
      let index = 0;
      index < span.text.length && quoted.length < token.value.length;
      index += 1
    )
      quoted.push(span.quoted);
  }
  while (quoted.length < token.value.length) quoted.push(false);
  return quoted;
}

export function hasQuotedChar(token: ShellToken): boolean {
  return quotedChars(token).includes(true);
}
