// ANSI-C quoting (`$'...'`): the value of a word in bash, bash 3.2 or zsh, the
// zsh-style reading of a heredoc delimiter, and which escapes the shells
// disagree on.

import { invariant } from "../../../../utils/invariant.ts";
import {
  decodeAnsiCControl,
  decodeAnsiCHex,
  decodeAnsiCOctal,
} from "./ansi-c-numeric.ts";
import { type DecodedEscape, decodeZshOther } from "./ansi-c-zsh.ts";

/** Unescape the `$'...'` region of a here-document delimiter word. Unknown
 *  escapes drop the backslash as zsh does, so the text is right for every
 *  shell only when `ansiCShellDependent` accepts the part; `scanDollarQuoted`
 *  marks the word unresolved otherwise. A delimiter containing a newline can
 *  never match a body line; it stays resolved and the body scan reports the
 *  heredoc as unterminated. */
export function unescapeAnsiC(
  command: string,
  start: number,
): { text: string; end: number; closed: boolean } {
  let text = "";
  let index = start;
  while (index < command.length) {
    const c = command.charAt(index);
    if (c === "'") return { text, end: index + 1, closed: true };
    if (c !== "\\") {
      text += c;
      index += 1;
      continue;
    }
    const escaped = command[index + 1];
    if (escaped === undefined) break;
    const unescaped = ansiCEscape(command, index, escaped);
    text += unescaped.text;
    index = unescaped.end;
  }
  return { text, end: index, closed: false };
}

const ANSI_C_SIMPLE_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  e: "\x1b",
  E: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "?": "?",
};

/** The text of the escape whose backslash is at `index`, and the index just
 *  past it. */
function ansiCEscape(
  command: string,
  index: number,
  escaped: string,
): { text: string; end: number } {
  if (escaped === "x") {
    const hex = /^[0-9a-fA-F]{1,2}/.exec(command.slice(index + 2));
    if (hex === null) return { text: "x", end: index + 2 };
    return {
      text: String.fromCharCode(Number.parseInt(hex[0], 16)),
      end: index + 2 + hex[0].length,
    };
  }
  if (/^[0-7]/.test(escaped)) {
    const octal = /^[0-7]{1,3}/.exec(command.slice(index + 1));
    invariant(octal, "escaped is an octal digit");
    return {
      text: String.fromCharCode(Number.parseInt(octal[0], 8)),
      end: index + 1 + octal[0].length,
    };
  }
  return { text: ANSI_C_SIMPLE_ESCAPES[escaped] ?? escaped, end: index + 2 };
}

/** `bash32` is bash 3.2, which keeps `\u` and `\U` literally. */
export type AnsiCDialect = "bash" | "bash32" | "zsh";

/** Whether an escape in `inner` (the text between `$'` and the closing `'`, as
 *  written) is read differently by bash, bash 3.2 and zsh: anything but a
 *  simple escape, an octal escape, or `\x` with a hex digit. `\c`, `\u` and
 *  `\U` always count, and so does a NUL with text after it, where bash ends
 *  the word and zsh keeps the rest. A NUL that ends the word gives the same
 *  argument in both; a heredoc delimiter checks for one itself. */
export function ansiCShellDependent(inner: string): boolean {
  let index = 0;
  while (index < inner.length) {
    if (inner.charAt(index) !== "\\") {
      index += 1;
      continue;
    }
    const bash = decodeAnsiCEscape(inner, index, "bash");
    if (
      textAfterNul(bash.text, inner.slice(bash.end)) ||
      bash.text !== decodeAnsiCEscape(inner, index, "zsh").text ||
      bash.text !== decodeAnsiCEscape(inner, index, "bash32").text
    )
      return true;
    index = bash.end;
  }
  return false;
}

/** Whether an escape's `text` has a NUL with more text after it, in the
 *  escape or in the `rest` of the word. */
function textAfterNul(text: string, rest: string): boolean {
  const nul = text.indexOf("\0");
  return nul !== -1 && (nul < text.length - 1 || rest !== "");
}

/** The value a `$'...'` word whose text between the quotes is `inner`, as
 *  written, has in `dialect` as a command's argument: escapes decoded, cut
 *  at the first NUL. In bash, unknown escapes and a bare `\x`, `\u` or `\U`
 *  keep their backslash, and bash 3.2 also keeps it for every `\u` and
 *  `\U`. */
export function decodeAnsiCWord(
  inner: string,
  dialect: AnsiCDialect = "bash",
): string {
  let value = "";
  let index = 0;
  while (index < inner.length) {
    if (inner.charAt(index) !== "\\" || index + 1 === inner.length) {
      value += inner.charAt(index);
      index += 1;
      continue;
    }
    const decoded = decodeAnsiCEscape(inner, index, dialect);
    value += decoded.text;
    index = decoded.end;
  }
  return value.split("\0", 1).join("");
}

/** The decoded escape whose backslash is at `index`, and the index just past it. */
function decodeAnsiCEscape(
  inner: string,
  index: number,
  dialect: AnsiCDialect,
): DecodedEscape {
  const escaped = inner.charAt(index + 1);
  const simple = ANSI_C_SIMPLE_ESCAPES[escaped];
  if (simple !== undefined) return { text: simple, end: index + 2 };
  if (/^[0-7]$/.test(escaped)) return decodeAnsiCOctal(inner, index);
  if (escaped === "c" && dialect !== "zsh")
    return decodeAnsiCControl(inner, index, dialect);
  const decoded =
    (dialect !== "bash32" || escaped === "x") &&
    decodeAnsiCHex(inner, index, escaped);
  if (decoded) return decoded;
  if (dialect === "zsh")
    return decodeZshOther(inner, index, escaped, (text, at) =>
      decodeAnsiCEscape(text, at, "zsh"),
    );
  return { text: `\\${escaped}`, end: index + 2 };
}
