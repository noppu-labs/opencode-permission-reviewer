// Character handlers that open single and double quotes and scan their inside.

import { appendValue, type LexState } from "./shell-lex-state.ts";

export function lexSingleQuoted(lex: LexState, c: string): void {
  lex.raw += c;
  if (c === "'") lex.inSingle = false;
  else appendValue(lex, c, true);
  lex.index += 1;
}

function lexDoubleQuotedEscape(lex: LexState): void {
  const next = lex.command.charAt(lex.index + 1);
  lex.raw += next;
  // Inside double quotes bash only unescapes $ ` " \ and the newline
  // (a line continuation). A backslash before any other character,
  // including `n`, stays a literal backslash in the value.
  if (next === "\n" || next === "\r") {
    lex.index += 2;
    return;
  }
  if ('$`"\\'.includes(next)) {
    appendValue(lex, next, true);
    lex.index += 2;
    return;
  }
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
  if (c === "'") lex.inSingle = true;
  else lex.inDouble = true;
  lex.raw += c;
  lex.hasToken = true;
  lex.index += 1;
}
