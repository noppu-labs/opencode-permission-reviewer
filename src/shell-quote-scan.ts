// Character handlers that open single and double quotes and scan their inside.

import { appendValue, type LexState } from "./shell-lex-state.ts";

export function lexSingleQuoted(lex: LexState, c: string): void {
  if (lex.ansiC && c === "\\" && lex.index + 1 < lex.command.length) {
    const pair = lex.command.slice(lex.index, lex.index + 2);
    lex.raw += pair;
    appendValue(lex, pair, true);
    lex.index += 2;
    return;
  }
  lex.raw += c;
  if (c === "'") {
    lex.inSingle = false;
    lex.ansiC = false;
  } else appendValue(lex, c, true);
  lex.index += 1;
}

// The `$` run that ends at the current character, counting only unquoted
// dollars: an escaped `\$` or one inside quotes does not join the run.
function unquotedDollarRun(lex: LexState): number {
  const last = lex.spans.at(-1);
  let run = 1;
  if (last === undefined || last.quoted) return run;
  for (let i = last.text.length - 1; i >= 0 && last.text[i] === "$"; i--)
    run += 1;
  return run;
}

/** True when the `$` at the current index opens an ANSI-C `$'…'` string:
 *  the next character is `'`, the scan reads bash's quoting, and the `$`
 *  run it ends is odd (so `$$'…'` stays a plain quote after the first `$`). */
export function opensAnsiC(lex: LexState): boolean {
  if (lex.command[lex.index] !== "$" || lex.command[lex.index + 1] !== "'")
    return false;
  if ("quoting" in lex.budget && lex.budget.quoting === "previous")
    return false;
  return unquotedDollarRun(lex) % 2 === 1;
}

function openAnsiC(lex: LexState): void {
  appendValue(lex, "$", false);
  lex.raw += "$";
  lex.index += 1;
  openQuote(lex, "'");
  lex.ansiC = true;
}

function lexDoubleQuotedEscape(lex: LexState): void {
  const next = lex.command.charAt(lex.index + 1);
  // Inside double quotes bash only unescapes $ ` " \ and the newline
  // (a line continuation). A backslash before any other character,
  // including `n`, stays a literal backslash in the value.
  if (next === "\n" || next === "\r") {
    lex.raw += next;
    lex.index += 2;
    return;
  }
  if ('$`"\\'.includes(next)) {
    lex.raw += next;
    appendValue(lex, next, true);
    lex.index += 2;
    return;
  }
  // The backslash stays literal and `next` is re-read as an ordinary
  // character, so only the backslash joins the token's source text.
  appendValue(lex, "\\", true);
  lex.index += 1;
}

export function lexDoubleQuoted(lex: LexState, c: string): void {
  lex.raw += c;
  if (c === '"') {
    lex.inDouble = false;
    lex.index += 1;
  } else if (c === "\\" && lex.index + 1 < lex.command.length) {
    lexDoubleQuotedEscape(lex);
  } else {
    appendValue(lex, c, true);
    lex.index += 1;
  }
}

export function openQuote(lex: LexState, c: string): void {
  if (c === "$") {
    openAnsiC(lex);
    return;
  }
  if (c === "'") lex.inSingle = true;
  else lex.inDouble = true;
  lex.raw += c;
  lex.hasToken = true;
  lex.index += 1;
}
