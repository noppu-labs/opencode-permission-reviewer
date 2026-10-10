// The lexer's scan state and the token and segment accumulators the character handlers fill.

import type { ShellSegment, ShellToken } from "./shell-token.ts";

type ShellSpan = NonNullable<ShellToken["spans"]>[number];

export interface LexBudget {
  tokensRemaining: number;
}

/** Mutable scan state shared by the character handlers in shell-scanner.ts
 *  and shell-quote-scan.ts. `index` is the next character of `command` to
 *  read. */
export interface LexState {
  command: string;
  budget: LexBudget | undefined;
  index: number;
  segments: ShellSegment[];
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
  if (lex.budget !== undefined) {
    lex.budget.tokensRemaining -= 1;
    if (lex.budget.tokensRemaining <= 0) lex.outOfTokens = true;
  }
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
}
