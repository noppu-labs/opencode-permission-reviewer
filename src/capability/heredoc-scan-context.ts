// The shell context the heredoc scan tracks: quoting, escapes, comments and
// the nesting of expansions, substitutions and groups, where `<<` opens no
// heredoc or reads its body from a different place.

/** The quote the scan is inside, when it is inside one. */
export type Quote = "'" | '"' | "$'" | undefined;

/** An open construct: the text that closes it, the quote it opened in, and
 *  what the shell reads a heredoc inside it. */
export interface Frame {
  close: string;
  quote: Quote;
  kind: "group" | "substitution" | "expansion" | "backtick";
}

/** The constructs that may open, most specific first: `$((` and `((` are
 *  arithmetic, where `<<` is a shift; `$(` is a command substitution, whose
 *  heredocs read bodies while it stays open across a line; `${` and `$[`
 *  are expansions the shell reads literally; `(` is a group, whose heredocs
 *  read bodies like any top-level one. */
export const OPENERS: ReadonlyArray<[string, Frame["close"], Frame["kind"]]> = [
  ["$((", "))", "expansion"],
  ["((", "))", "expansion"],
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
  /** Set when the scan reached text it cannot tell two readings of: after
   *  it, no heredoc operator may be trusted to have a body. */
  unsure: boolean;
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
 *  heredoc either. Stops at the newline. */
export function skipComment(scan: ScanContext, c: string): boolean {
  const { command } = scan;
  if (c !== "#" || !atCommandBoundary(command, scan.i)) return false;
  while (scan.i < command.length && command[scan.i] !== "\n") scan.i += 1;
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
  const [text, close, kind] = opener;
  scan.frames.push({ close, quote: scan.quote, kind });
  scan.i += text.length;
  return true;
}

/** The innermost frame whose close text sits at `scan.i`, if it ends there.
 *  A partial close (a lone `)` where `))` would end arithmetic) has two
 *  readings the scan cannot tell apart, so it marks the scan unsure and
 *  closes nothing. */
export function closingFrame(scan: ScanContext): Frame | undefined {
  const frame = scan.frames.at(-1);
  if (
    frame === undefined ||
    !frame.close.startsWith(scan.command.charAt(scan.i))
  )
    return undefined;
  if (!scan.command.startsWith(frame.close, scan.i)) {
    scan.unsure = true;
    return undefined;
  }
  return frame;
}
