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
 * The command a substitution runs is still lexed: an unquoted `$(` splits at
 * its parentheses, and a backtick form or a `$(` inside double quotes adds
 * the segments of its body after the segment holding it.
 */

import {
  appendValue,
  flushSegment,
  flushToken,
  type LexBudget,
  type LexState,
  MAX_SUBSTITUTION_CHARS,
  type SubstitutionBudget,
} from "./shell-lex-state.ts";
import {
  lexDoubleQuoted,
  lexSingleQuoted,
  openQuote,
} from "./shell-quote-scan.ts";
import { substitutionAt } from "./shell-substitution.ts";
import { type ShellSegment, tokenCharIsQuoted } from "./shell-token.ts";

const SEPARATORS = new Set([";", "|", "&", "\n", "(", ")"]);
const WHITESPACE = new Set([" ", "\t"]);

function appendUnquoted(lex: LexState, c: string): void {
  appendValue(lex, c, false);
  lex.raw += c;
  lex.hasToken = true;
  lex.index += 1;
}

// Redirection operators may contain characters that are command separators
// elsewhere. Keep `&>`, `2>&1`, `3<&0`, and `>|file` inside the token so the
// redirection normalizer (shell-redirections.ts) can interpret them as one
// shell construct instead of inventing extra commands.
function gluesToRedirection(lex: LexState, c: string): boolean {
  if (c === "&" && lex.command[lex.index + 1] === ">") return true;
  if (c !== "&" && c !== "|") return false;
  const last = lex.value.charAt(lex.value.length - 1);
  // `&` continues an output or input duplication operator (`>&`, `<&`);
  // `|` continues only an output redirection (`>|`).
  if (last === "" || (c === "|" && last !== ">")) return false;
  return (
    (last === ">" || last === "<") &&
    !tokenCharIsQuoted(
      { raw: lex.raw, value: lex.value, spans: lex.spans },
      lex.value.length - 1,
    )
  );
}

function lexSeparator(lex: LexState, c: string): void {
  // Capture the operator identity (including doubled `||`/`&&` and the
  // two-character `|&` and `;&`) so evidence consumers can reason about
  // how segments relate.
  let endedBy = c === "\n" ? ";" : c;
  const next = lex.command[lex.index + 1];
  if ((c === "|" || c === "&") && next === c) {
    endedBy = `${c}${c}`;
    lex.index += 1;
  } else if ((c === "|" || c === ";") && next === "&") {
    endedBy = `${c}&`;
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
  // Backslash-newline is a line continuation outside quotes: both
  // characters vanish, so `r\<newline>m` lexes as the token `rm`.
  if (next === "\n" || next === "\r") {
    // A continuation with no token in progress belongs to no token,
    // so it stays out of the next token's source text.
    if (lex.hasToken) lex.raw += `\\${next}`;
  } else {
    lex.raw += `\\${next}`;
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

/** Lex the body of a substitution that opens at the current character
 *  into segments of its own, under the same budget. The character itself is
 *  still scanned as part of the enclosing word. */
function lexSubstitution(lex: LexState, budget: SubstitutionBudget): void {
  if (lex.index < lex.substitutionEnd) return;
  const body = substitutionAt(
    lex.command,
    lex.index,
    lex.inDouble,
    lex.index < lex.arithmeticEnd,
  );
  if (body === undefined) return;
  if (body.kind === "arithmetic") {
    lex.arithmeticEnd = body.end;
    return;
  }
  lex.substitutionEnd = body.end;
  budget.substitutionCharsRemaining -= body.text.length;
  if (budget.substitutionCharsRemaining < 0) budget.tokensRemaining = 0;
  else {
    for (const segment of lexSegments(body.text, budget))
      lex.substitutions.push(segment);
  }
  if (budget.tokensRemaining <= 0) lex.outOfTokens = true;
}

/**
 * Tokenize `command` into logical segments (one per sub-command separated by
 * `;`, `|`, `&`, or newline) with quote-aware, comment-aware grouping.
 * `state` is the scan budget, with no token cap by default. Running out of
 * tokens or substitution characters stops the scan; callers that must not
 * miss tail content use `lexSegmentsBounded` and treat the stop as a
 * truncation fact.
 */
export function lexSegments(
  command: string,
  state: LexBudget = {
    tokensRemaining: Number.POSITIVE_INFINITY,
    substitutions: "lex",
    substitutionCharsRemaining: MAX_SUBSTITUTION_CHARS,
  },
): ShellSegment[] {
  const lex: LexState = {
    command,
    budget: state,
    index: 0,
    segments: [],
    substitutions: [],
    substitutionEnd: 0,
    arithmeticEnd: 0,
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
    if (!lex.inSingle && state.substitutions === "lex")
      lexSubstitution(lex, state);
    if (lex.outOfTokens) break;
    const c = command.charAt(lex.index);
    if (lex.inSingle) lexSingleQuoted(lex, c);
    else if (lex.inDouble) lexDoubleQuoted(lex, c);
    else lexUnquoted(lex, c);
  }
  if (!lex.outOfTokens) flushSegment(lex);
  return lex.segments;
}
