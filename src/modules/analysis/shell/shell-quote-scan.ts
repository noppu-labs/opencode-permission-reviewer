// Character handlers that open single and double quotes and scan their inside.

import {
  appendValue,
  closeAnsiC,
  endQuote,
  type LexState,
} from "./shell-lex-state.ts";

/** Adds text of the open single quote to the value; an ANSI-C string keeps
 *  its text as written until it closes, unless the scan reads it undecoded. */
function appendQuoted(lex: LexState, text: string): void {
  if (lex.ansiC && lex.budget.quoting !== "undecoded") lex.ansiCText += text;
  else appendValue(lex, text, true);
}

export function lexSingleQuoted(lex: LexState, c: string): void {
  if (lex.ansiC && c === "\\" && lex.index + 1 < lex.command.length) {
    const pair = lex.command.slice(lex.index, lex.index + 2);
    lex.raw += pair;
    appendQuoted(lex, pair);
    lex.index += 2;
    return;
  }
  lex.raw += c;
  if (c === "'") {
    lex.inSingle = false;
    if (lex.ansiC) closeAnsiC(lex);
    endQuote(lex);
  } else appendQuoted(lex, c);
  lex.index += 1;
}

/** Records the unquoted `$` run that ends at the unquoted character `c`, and
 *  reports whether `c` opens a quote: `'`, `"`, an ANSI-C `$'…'` or a
 *  locale `$"…"`. */
export function opensQuote(lex: LexState, c: string): boolean {
  const continuation = c === "\\" && lex.command[lex.index + 1] === "\n";
  if (c === "$") lex.dollarRun += 1;
  else if (!continuation) lex.dollarRun = 0;
  return c === "'" || c === '"' || opensDollarQuote(lex);
}

/** True when the `$` at the current index opens an ANSI-C `$'…'` string or a
 *  locale `$"…"` one: the next character is the quote, the run of unquoted
 *  `$` ending here is odd (so `$$'…'` stays a plain quote), and the scan
 *  reads bash's quoting. The `undecoded` reading opens `$'…'` only; the
 *  previous release's opens neither. */
function opensDollarQuote(lex: LexState): boolean {
  if (lex.command[lex.index] !== "$") return false;
  const next = lex.command[lex.index + 1];
  if (next !== "'" && next !== '"') return false;
  const { quoting } = lex.budget;
  if (quoting === "previous" || (quoting === "undecoded" && next === '"'))
    return false;
  return lex.dollarRun % 2 === 1;
}

/** Opens the string after the `$` at the current index. Bash's reading drops
 *  the `$`; the `undecoded` reading keeps it as unquoted text. */
function openDollarString(lex: LexState): void {
  const quote = lex.command.charAt(lex.index + 1);
  if (lex.budget.quoting === "undecoded") appendValue(lex, "$", false);
  lex.raw += "$";
  lex.index += 1;
  openQuote(lex, quote);
  lex.ansiC = quote === "'";
  lex.dollarRun = 0;
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
    endQuote(lex);
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
    openDollarString(lex);
    return;
  }
  if (c === "'") lex.inSingle = true;
  else lex.inDouble = true;
  lex.raw += c;
  lex.hasToken = true;
  lex.index += 1;
}
