// Ships to the TUI (the action fit) and runs on the server (the bounded action
// and segment texts), so it must not import a server-only module.

export const ELISION: string = " ⋯ ";
const ELISION_COLUMNS: number = Array.from(ELISION).length;

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

/** `value` on one line with whitespace runs collapsed and at most `max` code
 *  points: its middle elided around " ⋯ " when it is longer. */
export function boundedHeadTail(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const elided = elideMiddle(compact, max);
  return elided === undefined
    ? compact
    : `${elided.head}${ELISION}${elided.tail}`;
}
