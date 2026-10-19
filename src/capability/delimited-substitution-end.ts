// Where bash 3.2 ends a `$(` when it expands a heredoc body: it counts parentheses, skips quotes and backticks, and reads a `#` after a blank as a comment.

type Frame = "paren" | "double" | "brace";

interface Delimited {
  text: string;
  frames: Frame[];
  comment: boolean;
}

/**
 * The index of the `)` that ends the `$(` whose text starts at `start`, as
 * bash 3.2 finds it when it expands a heredoc body, or -1 when the text
 * ends first (bash then reports a bad substitution and expands no further).
 * It reads no `case` pattern, heredoc body or `${…}` outside double quotes,
 * so a `)` in any of them ends the substitution.
 */
export function delimitedSubstitutionEnd(text: string, start: number): number {
  const after = delimitedEnd(text, start, "paren");
  return after < 0 ? -1 : after - 1;
}

/** The index after the character that closes `first`, or -1. */
function delimitedEnd(text: string, start: number, first: Frame): number {
  const scan: Delimited = { text, frames: [first], comment: false };
  let index = start;
  while (index >= 0 && index < text.length) {
    index = stepFrame(scan, index);
    if (scan.frames.length === 0) return index;
  }
  return -1;
}

function stepFrame(scan: Delimited, index: number): number {
  const frame = scan.frames.at(-1);
  if (frame === "double") return stepDouble(scan, index);
  if (frame === "brace") return stepBrace(scan, index);
  return stepParen(scan, index);
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
  return after;
}

function close(scan: Delimited, index: number): number {
  scan.frames.pop();
  return index + 1;
}

/** The index after the backtick that closes the one at `index`, or -1. */
function pastBacktick(text: string, index: number): number {
  let at = index + 1;
  while (at < text.length && text.charAt(at) !== "`")
    at += text.charAt(at) === "\\" ? 2 : 1;
  return at < text.length ? at + 1 : -1;
}

/**
 * Whether bash 3.2 reads the `$((` whose text after `$((` up to its closing
 * `)` is `inner` as arithmetic: it must end with `)`, and the parentheses
 * before that must balance outside quotes. Otherwise it runs the text after
 * `$(` as a command.
 */
export function readsAsArithmetic(inner: string): boolean {
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
  const end = delimitedEnd(text, index + 1, "double");
  return end < 0 ? text.length : end;
}
