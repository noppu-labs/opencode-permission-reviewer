// Where bash 3.2 ends a `$(` when it expands a heredoc body: it counts parentheses, skips quotes and backticks, and reads a `#` after a blank as a comment.

/** `count` is a parenthesis frame as the arithmetic check reads it: no
 *  comments, and a backtick or the escape byte is a plain character. */
type Frame = "paren" | "count" | "double" | "brace";

interface Delimited {
  text: string;
  frames: Frame[];
  /** Where the text of each frame starts. */
  starts: number[];
  comment: boolean;
  kept: Kept;
}

/** Where the scan keeps the ends of the `paren` and the `count` frames it
 *  opens. */
interface Kept {
  paren?: DelimitedCloses | undefined;
  count?: DelimitedCloses | undefined;
}

/** The `)` that ends each parenthesis frame of one text, by the index its
 *  text starts at, or -1 for a frame the text ends inside. A frame is read
 *  the same way wherever the scan that opens it began, so one scan settles
 *  every frame it opens. */
export type DelimitedCloses = Map<number, number>;

/**
 * The index of the `)` that ends the `$(` whose text starts at `start`, as
 * bash 3.2 finds it when it expands a heredoc body, or -1 when the text
 * ends first (bash then reports a bad substitution and expands no further).
 * It reads no `case` pattern, heredoc body or `${…}` outside double quotes,
 * so a `)` in any of them ends the substitution. `closes`, when given, keeps
 * the end of every parenthesis frame the scan opens and is read first.
 */
export function delimitedSubstitutionEnd(
  text: string,
  start: number,
  closes?: DelimitedCloses,
): number {
  const known = closes?.get(start);
  if (known !== undefined) return known;
  const after = delimitedEnd(text, start, "paren", { paren: closes });
  return after < 0 ? -1 : after - 1;
}

/**
 * The index of the `)` that closes the parentheses opened right before
 * `start` as bash 3.2's arithmetic check counts them, or -1. `counts` keeps
 * the end of every such frame the scan opens and is read first.
 */
export function arithmeticCountEnd(
  text: string,
  start: number,
  counts: DelimitedCloses,
): number {
  const known = counts.get(start);
  if (known !== undefined) return known;
  const after = delimitedEnd(text, start, "count", { count: counts });
  return after < 0 ? -1 : after - 1;
}

/** The index after the character that closes `first`, or -1. */
function delimitedEnd(
  text: string,
  start: number,
  first: Frame,
  kept: Kept = {},
): number {
  const scan: Delimited = {
    text,
    frames: [first],
    starts: [start],
    comment: false,
    kept,
  };
  let index = start;
  while (index >= 0 && index < text.length) {
    index = stepFrame(scan, index);
    if (scan.frames.length === 0) return index;
  }
  for (const [at, frame] of scan.frames.entries())
    keep(scan, frame, scan.starts[at] ?? -1, -1);
  return -1;
}

function keep(scan: Delimited, frame: Frame, start: number, end: number): void {
  if (frame === "paren") scan.kept.paren?.set(start, end);
  if (frame === "count") scan.kept.count?.set(start, end);
}

function stepFrame(scan: Delimited, index: number): number {
  const frame = scan.frames.at(-1);
  if (frame === "double") return stepDouble(scan, index);
  if (frame === "brace") return stepBrace(scan, index);
  if (frame === "count") return stepCount(scan, index);
  return stepParen(scan, index);
}

/** The arithmetic check's reading: parentheses counted, quotes skipped,
 *  every other character plain. */
function stepCount(scan: Delimited, index: number): number {
  const c = scan.text.charAt(index);
  if (c === "(") return open(scan, "count", index + 1);
  if (c === ")") return close(scan, index);
  if (c === "\\") return index + 2;
  if (c === '"') return open(scan, "double", index + 1);
  if (c !== "'") return index + 1;
  const end = scan.text.indexOf("'", index + 1);
  return end < 0 ? -1 : end + 1;
}

function stepParen(scan: Delimited, index: number): number {
  const { text } = scan;
  const c = text.charAt(index);
  if (scan.comment) {
    scan.comment = c !== "\n";
    return index + 1;
  }
  const before = text.charAt(index - 1);
  if (c === "#" && (before === "\n" || before === " " || before === "\t")) {
    scan.comment = true;
    return index + 1;
  }
  if (c === "\\" || c === "\x01") return index + 2;
  if (c === "(" || (c === "$" && text.charAt(index + 1) === "("))
    return open(scan, "paren", index + (c === "(" ? 1 : 2));
  if (c === ")") return close(scan, index);
  return stepQuoted(scan, index);
}

function stepDouble(scan: Delimited, index: number): number {
  const c = scan.text.charAt(index);
  if (c === "\\") return index + 2;
  if (c === '"') return close(scan, index);
  if (c === "`") return pastBacktick(scan.text, index);
  return stepDollar(scan, index);
}

function stepBrace(scan: Delimited, index: number): number {
  const c = scan.text.charAt(index);
  if (c === "\\" || c === "\x01") return index + 2;
  if (c === "}") return close(scan, index);
  return stepQuoted(scan, index);
}

/** A backtick or quote, or else a `$(` or `${`, at `index`. */
function stepQuoted(scan: Delimited, index: number): number {
  const c = scan.text.charAt(index);
  if (c === "`") return pastBacktick(scan.text, index);
  if (c === '"') return open(scan, "double", index + 1);
  if (c !== "'") return stepDollar(scan, index);
  const end = scan.text.indexOf("'", index + 1);
  return end < 0 ? -1 : end + 1;
}

/** A `$(` or `${` at `index` opens a frame; anything else is one character.
 *  A paren frame reads a `${` as text. */
function stepDollar(scan: Delimited, index: number): number {
  const next = scan.text.charAt(index + 1);
  if (scan.text.charAt(index) !== "$") return index + 1;
  if (next === "(") return open(scan, "paren", index + 2);
  if (next === "{" && scan.frames.at(-1) !== "paren")
    return open(scan, "brace", index + 2);
  return index + 1;
}

function open(scan: Delimited, frame: Frame, after: number): number {
  scan.frames.push(frame);
  scan.starts.push(after);
  return after;
}

function close(scan: Delimited, index: number): number {
  const frame = scan.frames.pop();
  const start = scan.starts.pop() ?? -1;
  if (frame !== undefined) keep(scan, frame, start, index);
  return index + 1;
}

/** The index after the backtick that closes the one at `index`, or -1. */
function pastBacktick(text: string, index: number): number {
  let at = index + 1;
  while (at < text.length && text.charAt(at) !== "`")
    at += text.charAt(at) === "\\" ? 2 : 1;
  return at < text.length ? at + 1 : -1;
}

/** The index after the `"` that closes the double quote whose text starts
 *  at `start`, or -1. */
export function doubleQuoteEnd(text: string, start: number): number {
  return delimitedEnd(text, start, "double");
}
