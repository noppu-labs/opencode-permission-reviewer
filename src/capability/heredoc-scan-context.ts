// The shell context the heredoc scan tracks: quoting, escapes, comments and
// the nesting of expansions, substitutions and groups, where `<<` opens no
// heredoc or reads its body from a different place.

/** The quote the scan is inside, when it is inside one. */
export type Quote = "'" | '"' | "$'" | undefined;

/** An open construct: the text that closes it, the quote it opened in, and
 *  what the shell reads a heredoc inside it. A backtick reads a body like a
 *  `$(` substitution. `fallback` is set on an arithmetic frame: the kind
 *  bash reads its opener as when the arithmetic does not parse. */
export interface Frame {
  close: string;
  quote: Quote;
  kind: "group" | "substitution" | "expansion" | "backtick";
  fallback?: "group" | "substitution";
}

/** The constructs that may open, most specific first: `$((` and `((` are
 *  arithmetic, where `<<` is a shift, and fall back to a substitution around
 *  a group and to two nested groups when a lone `)` closes them; `$(` is a
 *  command substitution, whose heredocs read bodies while it stays open
 *  across a line; `${` and `$[` are expansions the shell reads literally;
 *  `(` is a group, whose heredocs read bodies like any top-level one. */
export const OPENERS: ReadonlyArray<
  [string, Frame["close"], Frame["kind"], Frame["fallback"]?]
> = [
  ["$((", "))", "expansion", "substitution"],
  ["((", "))", "expansion", "group"],
  ["$(", ")", "substitution"],
  ["${", "}", "expansion"],
  ["$[", "]", "expansion"],
  ["(", ")", "group"],
];

/** The part of the heredoc scan state that tracks where in the shell
 *  syntax `i` is. */
export interface ScanContext {
  command: string;
  i: number;
  quote: Quote;
  /** Open constructs, innermost last. */
  frames: Frame[];
}

export function scanInsideQuotes(scan: ScanContext, c: string): boolean {
  if (scan.quote === "'") {
    if (c === "'") scan.quote = undefined;
    scan.i += 1;
    return true;
  }
  if (scan.quote === '"' || scan.quote === "$'") {
    if (c === (scan.quote === '"' ? '"' : "'")) scan.quote = undefined;
    scan.i += c === "\\" ? 2 : 1;
    return true;
  }
  return false;
}

export function scanQuoteOrEscape(scan: ScanContext, c: string): boolean {
  if (c === "'" || c === '"') {
    scan.quote = c;
    scan.i += 1;
    return true;
  }
  if (c === "$" && scan.command.charAt(scan.i + 1) === "'") {
    scan.quote = "$'";
    scan.i += 2;
    return true;
  }
  if (c === "\\" && scan.i + 1 < scan.command.length) {
    scan.i += 2;
    return true;
  }
  return false;
}

/** A comment hides the rest of its line from the shell, so it can hide no
 *  heredoc either. Stops at the newline, or at the closing backtick when the
 *  comment sits inside backticks: the shell ends the substitution there. */
export function skipComment(scan: ScanContext, c: string): boolean {
  const { command } = scan;
  if (c !== "#" || !atCommandBoundary(command, scan.i)) return false;
  const inBackticks = scan.frames.at(-1)?.kind === "backtick";
  while (
    scan.i < command.length &&
    command[scan.i] !== "\n" &&
    !(inBackticks && command[scan.i] === "`")
  )
    scan.i += 1;
  return true;
}

/** Whether the character at `i` starts a word: first in the command, or after
 *  whitespace or `;&|()`. */
function atCommandBoundary(command: string, i: number): boolean {
  return i === 0 || /[\s;&|()]/.test(command.charAt(i - 1));
}

/** Open the construct starting at `scan.i`, if one starts there. `((` is
 *  arithmetic only at a command position; glued to a word it opens no
 *  expansion frame, and `<<` after it reads a heredoc as anywhere else. */
export function openFrame(scan: ScanContext): boolean {
  const opener = OPENERS.find(
    ([text, , kind]) =>
      scan.command.startsWith(text, scan.i) &&
      (text !== "((" ||
        kind !== "expansion" ||
        atCommandBoundary(scan.command, scan.i)),
  );
  if (opener === undefined) return false;
  const [text, close, kind, fallback] = opener;
  scan.frames.push({
    close,
    quote: scan.quote,
    kind,
    ...(fallback === undefined ? {} : { fallback }),
  });
  scan.i += text.length;
  return true;
}

/** The innermost frame whose close text sits at `scan.i`, if it ends there.
 *  Only finds the frame: the caller pops it. */
export function closingFrame(scan: ScanContext): Frame | undefined {
  const frame = scan.frames.at(-1);
  if (frame === undefined || !scan.command.startsWith(frame.close, scan.i))
    return undefined;
  return frame;
}

/** A lone `)` where an arithmetic frame's `))` would close it: bash reads the
 *  opener as its fallback instead, so the frame becomes the outer construct
 *  (a group for `((`, a substitution for `$((`) and this `)` closes the
 *  inner group the fallback opened. Consumes the `)`, leaves the frame open,
 *  and returns true; false when no such close sits at `scan.i`. */
export function fallBackFromArithmetic(scan: ScanContext): boolean {
  const frame = scan.frames.at(-1);
  if (
    frame?.fallback === undefined ||
    scan.command[scan.i] !== ")" ||
    scan.command.startsWith("))", scan.i)
  )
    return false;
  scan.frames[scan.frames.length - 1] = {
    close: ")",
    quote: frame.quote,
    kind: frame.fallback,
  };
  scan.i += 1;
  return true;
}
