// The lexer's scan state and the token and segment accumulators the character handlers fill.

import type { ShellSegment, ShellToken } from "./shell-token.ts";

type ShellSpan = NonNullable<ShellToken["spans"]>[number];

interface TokenBudget {
  tokensRemaining: number;
}

/** Which heredoc reading a substitution's body is sanitized with before it is
 *  lexed: the current extractor (`default`), or the previous release's
 *  (`legacy`), which the emergency brake also checks. */
export type HeredocReading = "default" | "legacy";

/** A budget that lexes command substitutions into segments of their own. */
export interface SubstitutionBudget extends TokenBudget {
  substitutions: "lex";
  /** Heredoc reading for the substitution bodies this scan lexes. */
  reading?: HeredocReading;
  /** Command-substitution text the scan may still lex a second time, nested
   *  substitutions included. Past zero the scan stops as if out of tokens. */
  substitutionCharsRemaining: number;
}

/** `skip` leaves command substitutions unlexed: no body segments and no
 *  substitution budget is charged. */
export type LexBudget =
  | (TokenBudget & { substitutions: "skip" })
  | SubstitutionBudget;

/** Ceiling on the substitution text one scan re-lexes by default: nested
 *  substitutions re-lex their body once per level. */
export const MAX_SUBSTITUTION_CHARS = 262_144;

/** Mutable scan state shared by the character handlers in shell-scanner.ts
 *  and shell-quote-scan.ts. `index` is the next character of `command` to
 *  read. */
export interface LexState {
  command: string;
  budget: LexBudget;
  index: number;
  segments: ShellSegment[];
  /** Segments of the substitutions opened in the current segment, emitted
   *  right after it. */
  substitutions: ShellSegment[];
  /** Index up to which the text belongs to a substitution already lexed. */
  substitutionEnd: number;
  /** Index up to which the text is inside double-quoted `$((…))`. */
  arithmeticEnd: number;
  tokens: ShellToken[];
  value: string;
  raw: string;
  hasToken: boolean;
  spans: ShellSpan[];
  inSingle: boolean;
  inDouble: boolean;
  lastSeparator: string | undefined;
  outOfTokens: boolean;
}

export function appendValue(
  lex: LexState,
  text: string,
  quoted: boolean,
): void {
  if (text.length === 0) return;
  const last = lex.spans.at(-1);
  if (last !== undefined && last.quoted === quoted) last.text += text;
  else lex.spans.push({ text, quoted });
  lex.value += text;
}

export function flushToken(lex: LexState): void {
  if (!lex.hasToken) return;
  lex.tokens.push({ raw: lex.raw, value: lex.value, spans: lex.spans });
  lex.value = "";
  lex.raw = "";
  lex.spans = [];
  lex.hasToken = false;
  lex.budget.tokensRemaining -= 1;
  if (lex.budget.tokensRemaining <= 0) lex.outOfTokens = true;
}

export function flushSegment(lex: LexState, endedBy?: string): void {
  flushToken(lex);
  // Paren separators survive as empty marker segments even without tokens:
  // the directory tracker needs every open/close event, and dropping the
  // empties left nested closes unbalanced (`( cd x; (a) ) b` restored the
  // wrong state after the group). Other empty flushes stay dropped.
  if (lex.tokens.length > 0 || endedBy === "(" || endedBy === ")") {
    lex.segments.push({
      tokens: lex.tokens,
      ...(endedBy === undefined ? {} : { endedBy }),
      ...(lex.lastSeparator === undefined
        ? {}
        : { precededBy: lex.lastSeparator }),
    });
    lex.tokens = [];
  }
  for (const segment of lex.substitutions) lex.segments.push(segment);
  lex.substitutions = [];
}
