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

/** Return a token slice while preserving quote provenance for each character. */
export function sliceToken(
  token: ShellToken,
  start: number,
  end = token.value.length,
): ShellToken {
  const value = token.value.slice(start, end);
  const spans: Array<{ text: string; quoted: boolean }> = [];
  let offset = 0;
  for (const span of token.spans ?? [
    { text: token.value, quoted: token.raw !== token.value },
  ]) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    const from = Math.max(start, spanStart);
    const to = Math.min(end, spanEnd);
    if (from < to) {
      const text = span.text.slice(from - spanStart, to - spanStart);
      const previous = spans.at(-1);
      if (previous?.quoted === span.quoted) previous.text += text;
      else spans.push({ text, quoted: span.quoted });
    }
    offset = spanEnd;
  }
  return { raw: value, value, spans };
}

export function hasQuotedChar(token: ShellToken): boolean {
  for (let index = 0; index < token.value.length; index += 1) {
    if (tokenCharIsQuoted(token, index)) return true;
  }
  return false;
}
