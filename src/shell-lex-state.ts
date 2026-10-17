// The lexer's scan state and the token and segment accumulators the character handlers fill.

import { decodeAnsiCWord } from "./capability/ansi-c-quoting.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";

type ShellSpan = NonNullable<ShellToken["spans"]>[number];

interface TokenBudget {
  tokensRemaining: number;
}

/** Which heredoc reading a substitution's body is sanitized with before it is
 *  lexed: the current extractor (`default`), or the previous release's
 *  (`legacy`), which the emergency brake also checks. */
export type HeredocReading = "default" | "legacy";

/** Which quote reading the scan applies: bash's (`bash`, the default), where
 *  a `$'…'` or `$"…"` word has the value the shell gives it; the reading that
 *  ends a `$'…'` string where bash does but keeps its text and its `$` as
 *  written (`undecoded`); or the previous release's, which ends a `$'…'`
 *  string at its first `'` (`previous`). */
export type ShellQuoting = "bash" | "undecoded" | "previous";

/** A budget that lexes command substitutions into segments of their own. */
export interface SubstitutionBudget extends TokenBudget {
  substitutions: "lex";
  /** Heredoc reading for the substitution bodies this scan lexes. */
  reading?: HeredocReading;
  /** Quote reading for this scan and the substitution bodies it lexes. */
  quoting?: ShellQuoting;
  /** Command-substitution text the scan may still lex a second time, nested
   *  substitutions included. Past zero the scan stops as if out of tokens. */
  substitutionCharsRemaining: number;
}

/** `skip` leaves command substitutions unlexed: no body segments and no
 *  substitution budget is charged. */
export type LexBudget =
  | (TokenBudget & { substitutions: "skip"; quoting?: ShellQuoting })
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
  /** The open single quote is an ANSI-C `$'…'` string, where `\` escapes
   *  the next character. */
  ansiC: boolean;
  /** The text of the open `$'…'` string as written, escapes included, decoded
   *  into the token's value once the string closes. */
  ansiCText: string;
  /** Unquoted, unescaped `$` characters ending at the current character. Any
   *  other unquoted character, and any quote open, resets it to 0. */
  dollarRun: number;
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

/** Whether the last character of `lex.value` is quoted. That character lies
 *  in the last span, since `value` is the spans' text in order. */
export function lastCharIsQuoted(lex: LexState): boolean {
  return lex.spans.at(-1)?.quoted === true;
}

/** Characters a redirection operator can end in. */
const OPERATOR_END = /[<>&|-]$/;

/** Notes that a quote just closed. Under bash's reading an empty quote right
 *  after unquoted text that ends like a redirection operator leaves an empty
 *  quoted span, so the word still shows that its text ended in a quote: the
 *  operator has an empty target and takes no more of the command. The
 *  `undecoded` and `previous` readings keep the previous release's spans,
 *  which leave it out. */
export function endQuote(lex: LexState): void {
  if ((lex.budget.quoting ?? "bash") !== "bash") return;
  const last = lex.spans.at(-1);
  if (last?.quoted === false && OPERATOR_END.test(last.text))
    lex.spans.push({ text: "", quoted: true });
}

/** The last character of `lex.value`, read from the last span so the growing
 *  value string is never flattened; "" when the value is empty. */
export function lastValueChar(lex: LexState): string {
  const last = lex.spans.at(-1);
  return last === undefined ? "" : last.text.charAt(last.text.length - 1);
}

/** Ends the open `$'…'` string: its text, decoded the way the shell does,
 *  joins the value as quoted text. Nothing was collected under the
 *  `undecoded` reading, which appends the text as it scans. */
export function closeAnsiC(lex: LexState): void {
  appendValue(lex, decodeAnsiCWord(lex.ansiCText), true);
  lex.ansiCText = "";
  lex.ansiC = false;
}

export function flushToken(lex: LexState): void {
  if (!lex.hasToken) return;
  if (lex.ansiC) closeAnsiC(lex);
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
