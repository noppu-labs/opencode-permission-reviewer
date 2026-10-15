// Ships to the TUI (the action fit) and runs on the server (the bounded action
// and segment texts), so it must not import a server-only module.

export const ELISION: string = " ⋯ ";
export const LINE_BREAK: string = "⏎";
const ELISION_COLUMNS: number = Array.from(ELISION).length;
const ESCAPED =
  // Each member matches one code point on its own, so no adjacent pair
  // should read as a combined character; the combining grapheme joiner is
  // therefore listed first.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: action text renders C0/C1, bidi, format and non-ASCII space code points as visible escapes
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: intentional per-code-point match for variation selectors, joiners and combining grapheme joiner
  /[\u034f\u0000-\u0008\u000b-\u001f\u007f-\u00a0\u00ad\u061c\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u21b5\u22ef\u23ce\u3000\ud800-\udfff\ufe00-\ufe0f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

function escapeChar(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (code <= 0xff) return `\\x${code.toString(16).padStart(2, "0")}`;
  if (code <= 0xffff) return `\\u${code.toString(16).padStart(4, "0")}`;
  return `\\u{${code.toString(16)}}`;
}

/** `value` with invisible, directional, control and marker characters escaped,
 *  line continuations marked with `\⏎`, line breaks marked with `⏎`, and runs
 *  of spaces and tabs collapsed. */
export function renderActionText(value: string): string {
  return value
    .replace(ESCAPED, escapeChar)
    .replace(/\\\n/g, `\\${LINE_BREAK}`)
    .replace(/\n/g, ` ${LINE_BREAK} `)
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Whether whole words of `kept` code points use at least half of `max`, so
 *  the cut may fall between words rather than inside one. */
const wordCut = (kept: number, max: number): boolean =>
  kept > 0 && kept * 2 >= max;

/** The longest prefix of `text` made of whole words within `max` code
 *  points; a hard cut at `max` when those words would use less than half of
 *  it. Always a prefix of `text` (trailing spaces trimmed). */
export function keepHead(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let end = max;
  while (end > 0 && chars[end] !== " ") end -= 1;
  const head = wordCut(end, max)
    ? chars.slice(0, end)
    : chars.slice(0, Math.max(0, max));
  return head.join("").trimEnd();
}

/** The longest suffix of `text` made of whole words within `max` code
 *  points; a hard cut at `max` when those words would use less than half of
 *  it. Always a suffix of `text` (leading spaces trimmed). */
export function keepTail(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let start = chars.length - max;
  while (start < chars.length && chars[start - 1] !== " ") start += 1;
  const tail = wordCut(chars.length - start, max)
    ? chars.slice(start)
    : chars.slice(chars.length - max);
  return tail.join("").trimStart();
}

/** `text` split into a head and a tail that fit `max` code points together
 *  with " ⋯ " between them, the head taking at most half; undefined when
 *  `text` already fits. */
export function elideMiddle(
  text: string,
  max: number,
): { head: string; tail: string } | undefined {
  if (Array.from(text).length <= max) return undefined;
  const budget = Math.max(0, max - ELISION_COLUMNS);
  const head = keepHead(text, Math.ceil(budget / 2));
  return { head, tail: keepTail(text, budget - Array.from(head).length) };
}

/** `value` on one line with escapes and line-break markers applied and at most
 *  `max` code points: its middle elided around " ⋯ " when it is longer. */
export function boundedHeadTail(value: string, max: number): string {
  const compact = renderActionText(value);
  const elided = elideMiddle(compact, max);
  return elided === undefined
    ? compact
    : `${elided.head}${ELISION}${elided.tail}`;
}
