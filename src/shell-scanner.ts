/*
 * Minimal shell-aware tokenizer, NOT a full shell interpreter:
 *   - grouping of single/double quotes (so separators inside quotes do not
 *     split a token, and `printf "a; sudo rm -rf /"` stays one argument),
 *   - splitting on logical command separators (`;`, `|`, `&`, newlines),
 *   - stripping `#` comments when they begin a token.
 *
 * It deliberately does NOT expand variables, globs, command substitutions,
 * heredocs, or arithmetic. Those remain the model reviewer's job; the brake
 * is only a last line of defense for *unmistakable* literal destruction.
 */

import {
  appendValue,
  flushSegment,
  flushToken,
  type LexState,
} from "./shell-lex-state.ts";
import {
  lexDoubleQuoted,
  lexSingleQuoted,
  openQuote,
} from "./shell-quote-scan.ts";
import { type ShellSegment, tokenCharIsQuoted } from "./shell-token.ts";

const SEPARATORS = new Set([";", "|", "&", "\n", "\r", "(", ")"]);
const WHITESPACE = new Set([" ", "\t"]);

function appendUnquoted(lex: LexState, c: string): void {
  appendValue(lex, c, false);
  lex.raw += c;
  lex.hasToken = true;
  lex.index += 1;
}

// Redirection operators may contain characters that are command separators
// elsewhere. Keep `&>`, `2>&1`, and `>|file` inside the token so the
// redirection normalizer (shell-redirections.ts) can interpret them as one
// shell construct instead of inventing extra commands.
function gluesToRedirection(lex: LexState, c: string): boolean {
  if (c === "&" && lex.command[lex.index + 1] === ">") return true;
  if (c !== "&" && c !== "|") return false;
  return (
    lex.value.endsWith(">") &&
    !tokenCharIsQuoted(
      { raw: lex.raw, value: lex.value, spans: lex.spans },
      lex.value.length - 1,
    )
  );
}

function lexSeparator(lex: LexState, c: string): void {
  // Capture the operator identity (including doubled `||`/`&&`) so
  // evidence consumers can reason about how segments relate.
  let endedBy = c === "\n" || c === "\r" ? ";" : c;
  if ((c === "|" || c === "&") && lex.command[lex.index + 1] === c) {
    endedBy = `${c}${c}`;
    lex.index += 1;
  }
  flushSegment(lex, endedBy);
  lex.lastSeparator = endedBy;
  lex.index += 1;
}

function skipComment(lex: LexState): void {
  // Line comment: consume until newline (newline itself closes the segment).
  while (lex.index < lex.command.length && lex.command[lex.index] !== "\n")
    lex.index += 1;
}

function lexEscape(lex: LexState): void {
  const next = lex.command.charAt(lex.index + 1);
  lex.raw += `\\${next}`;
  // Backslash-newline is a line continuation outside quotes: both
  // characters vanish, so `r\<newline>m` lexes as the token `rm`.
  if (next !== "\n" && next !== "\r") {
    appendValue(lex, next, true);
    lex.hasToken = true;
  }
  lex.index += 2;
}

function lexUnquoted(lex: LexState, c: string): void {
  if (c === "'" || c === '"') {
    openQuote(lex, c);
    return;
  }
  if (gluesToRedirection(lex, c)) {
    appendUnquoted(lex, c);
    return;
  }
  if (SEPARATORS.has(c)) {
    lexSeparator(lex, c);
    return;
  }
  if (WHITESPACE.has(c)) {
    flushToken(lex);
    lex.index += 1;
    return;
  }
  if (c === "#" && !lex.hasToken) {
    skipComment(lex);
    return;
  }
  if (c === "\\" && lex.index + 1 < lex.command.length) {
    lexEscape(lex);
    return;
  }
  appendUnquoted(lex, c);
}

/**
 * Tokenize `command` into logical segments (one per sub-command separated by
 * `;`, `|`, `&`, or newline) with quote-aware, comment-aware grouping.
 * `state.tokensRemaining` (when given) is decremented per token and stops
 * the scan at zero: callers that must not miss tail content use
 * `lexSegmentsBounded` and treat the stop as a truncation fact.
 */
export function lexSegments(
  command: string,
  state?: { tokensRemaining: number },
): ShellSegment[] {
  const lex: LexState = {
    command,
    budget: state,
    index: 0,
    segments: [],
    tokens: [],
    value: "",
    raw: "",
    hasToken: false,
    spans: [],
    inSingle: false,
    inDouble: false,
    lastSeparator: undefined,
    outOfTokens: false,
  };
  while (lex.index < command.length) {
    if (lex.outOfTokens) break;
    const c = command.charAt(lex.index);
    if (lex.inSingle) lexSingleQuoted(lex, c);
    else if (lex.inDouble) lexDoubleQuoted(lex, c);
    else lexUnquoted(lex, c);
  }
  if (!lex.outOfTokens) flushSegment(lex);
  return lex.segments;
}
