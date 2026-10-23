// The shell context the heredoc scan tracks: quoting, escapes, comments and
// the nesting of expansions, substitutions and groups, where `<<` opens no
// heredoc or reads its body from a different place.

import {
  closingBacktick,
  isArithmeticSpan,
  parenCloses,
} from "./heredoc-frame-bounds.ts";
import { linkFrame, pushFrame } from "./heredoc-frame-links.ts";

/** The quote the scan is inside, when it is inside one. */
export type Quote = "'" | '"' | "$'" | undefined;

/** An open construct: the text that closes it, the quote it opened in, and
 *  what the shell reads a heredoc inside it. A backtick reads a body like a
 *  `$(` substitution. `fallback` is set on a bare `((` frame: the kind bash
 *  reads its opener as when the arithmetic does not parse. `limit` is the
 *  index where a bounded construct (a backtick, or a `$((` substitution)
 *  closes; a heredoc body it opens ends there. */
export interface Frame {
  close: string;
  quote: Quote;
  kind: "group" | "substitution" | "expansion" | "backtick";
  fallback?: "group" | "substitution";
  limit?: number;
  /** Stack index of the nearest substitution or backtick frame at or below
   *  this one, or -1. Set when the frame is pushed, so the queries on the
   *  scan's frames read the top frame instead of walking the stack. */
  subst: number;
  /** Stack index of the nearest frame at or below this one with a `limit`, or
   *  -1. */
  limitAt: number;
  /** Stack index of the nearest expansion, substitution or backtick frame at
   *  or below this one, or -1. */
  bodyAt: number;
}

/** The constructs that may open, most specific first: `$((` is decided by
 *  `openDollarParen` (arithmetic, or a substitution ending at its matched
 *  `)`); `((` is arithmetic, where `<<` is a shift, and falls back to two
 *  nested groups when a lone `)` closes it; `$(` is a command substitution,
 *  whose heredocs read bodies while it stays open across a line; `${` and
 *  `$[` are expansions the shell reads literally; `(` is a group, whose
 *  heredocs read bodies like any top-level one. */
export const OPENERS: ReadonlyArray<
  [string, Frame["close"], Frame["kind"], Frame["fallback"]?]
> = [
  ["$((", "))", "expansion"],
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
  /** The index in `frames` of the open backtick substitution, or -1. At most
   *  one is open: a backtick inside one is its closing backtick. */
  backtickAt: number;
  /** The `parenCloses` table of `command`, built on the first `$((`. */
  parens?: Int32Array;
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

/** Open a quote or skip an escape at `scan.i`. `ansiC` reads `$'…'` as one
 *  quoted string; the previous release did not, and reads its `'` as opening
 *  an ordinary single-quoted string. */
export function scanQuoteOrEscape(
  scan: ScanContext,
  c: string,
  ansiC = true,
): boolean {
  if (c === "'" || c === '"') {
    scan.quote = c;
    scan.i += 1;
    return true;
  }
  if (ansiC && c === "$" && scan.command.charAt(scan.i + 1) === "'") {
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
 *  heredoc either. Stops at the newline, or at the closing backtick of an
 *  enclosing backtick substitution: the shell cuts that text there first. */
export function skipComment(scan: ScanContext, c: string): boolean {
  const { command } = scan;
  if (c !== "#" || !atCommandBoundary(command, scan.i)) return false;
  const backtick =
    scan.backtickAt < 0 ? undefined : scan.frames[scan.backtickAt]?.limit;
  while (
    scan.i < command.length &&
    command[scan.i] !== "\n" &&
    scan.i !== backtick
  )
    scan.i += 1;
  return true;
}

/** Whether the character at `i` starts a word: first in the command, or after
 *  whitespace or `;&|()`. */
export function atCommandBoundary(command: string, i: number): boolean {
  return i === 0 || /[\s;&|()]/.test(command.charAt(i - 1));
}

/** Open the construct starting at `scan.i`, if one starts there. `((` is
 *  arithmetic only at a command position; glued to a word it opens no
 *  expansion frame, and `<<` after it reads a heredoc as anywhere else. */
export function openFrame(scan: ScanContext): boolean {
  if (scan.command.startsWith("$((", scan.i)) return openDollarParen(scan);
  const opener = OPENERS.find(
    ([text, , kind]) =>
      scan.command.startsWith(text, scan.i) &&
      (text !== "((" ||
        kind !== "expansion" ||
        atCommandBoundary(scan.command, scan.i)),
  );
  if (opener === undefined) return false;
  const [text, close, kind, fallback] = opener;
  pushFrame(scan, {
    close,
    quote: scan.quote,
    kind,
    ...(fallback === undefined ? {} : { fallback }),
  });
  scan.i += text.length;
  return true;
}

/** Open a `$((` span. Bash decides it once: arithmetic when the `)` matching
 *  the second `(` is followed by `)`, otherwise a command substitution that
 *  ends at the `)` matching the first `(`. */
function openDollarParen(scan: ScanContext): boolean {
  const { command, i } = scan;
  scan.parens ??= parenCloses(command);
  if (isArithmeticSpan(command, i, scan.parens)) {
    pushFrame(scan, { close: "))", quote: scan.quote, kind: "expansion" });
    scan.i += 3;
    return true;
  }
  const closed = scan.parens[i + 2] ?? -1;
  const limit = closed === -1 ? undefined : closed;
  pushFrame(scan, {
    close: ")",
    quote: scan.quote,
    kind: "substitution",
    ...(limit === undefined ? {} : { limit }),
  });
  scan.i += 2;
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

/** A lone `)` where a bare `((` frame's `))` would close it: bash reads the
 *  opener as its fallback instead, so the frame becomes a group and this `)`
 *  closes the inner group the fallback opened. Consumes the `)`, leaves the
 *  frame open, and returns true; false when no such close sits at `scan.i`. */
export function fallBackFromArithmetic(scan: ScanContext): boolean {
  const frame = scan.frames.at(-1);
  if (
    frame?.fallback === undefined ||
    scan.command[scan.i] !== ")" ||
    scan.command.startsWith("))", scan.i)
  )
    return false;
  const index = scan.frames.length - 1;
  scan.frames[index] = linkFrame(scan.frames, index, {
    close: ")",
    quote: frame.quote,
    kind: frame.fallback,
  });
  scan.i += 1;
  return true;
}

/** A backtick opens a substitution frame, read like `$(`: a heredoc operator
 *  inside it reads a body while the backtick stays open across the newline,
 *  and that body ends at the closing backtick. */
export function openBacktick(scan: ScanContext): void {
  const limit = closingBacktick(scan.command, scan.i + 1);
  scan.backtickAt = scan.frames.length;
  pushFrame(scan, {
    close: "`",
    quote: scan.quote,
    kind: "backtick",
    ...(limit === undefined ? {} : { limit }),
  });
  scan.i += 1;
}
