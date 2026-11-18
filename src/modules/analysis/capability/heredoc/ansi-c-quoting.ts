// ANSI-C quoting (`$'...'`): the value of a word in bash or zsh, the zsh-style
// reading of a heredoc delimiter, and which escapes the two shells disagree on.

import { invariant } from "../../../../utils/invariant.ts";
import { decodeZshOther } from "./ansi-c-zsh.ts";

/** Unescape an ANSI-C quoted region (`$'...'`), the subset bash defines for
 *  here-document delimiter words: standard escapes, `\xHH` hex, and up to
 *  three octal digits. Unknown escapes drop the backslash, the way zsh reads
 *  them; bash keeps it. Task 2's caller stops relying on that. A
 *  delimiter containing a newline can never match a body line; it stays
 *  resolved and the body scan reports the heredoc as unterminated. */
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

export type AnsiCDialect = "bash" | "zsh";

/** Whether an escape in `inner` (the text between `$'` and the closing `'`, as
 *  written) is read differently by bash and zsh: anything but a simple escape,
 *  an octal escape, or `\x`, `\u` or `\U` with a hex digit. `\c` always
 *  counts. `\u` and `\U` with digits don't: bash 3.2 keeps them literal, but
 *  that can't be more dangerous than the decoded value. */
export function ansiCShellDependent(inner: string): boolean {
  let index = 0;
  while (index < inner.length) {
    if (inner.charAt(index) !== "\\") {
      index += 1;
      continue;
    }
    const bash = decodeAnsiCEscape(inner, index, "bash");
    if (bash.text !== decodeAnsiCEscape(inner, index, "zsh").text) return true;
    index = bash.end;
  }
  return false;
}

/** The value a `$'...'` word whose text between the quotes is `inner`, as
 *  written, has in `dialect`: escapes decoded, cut at the first NUL. In bash,
 *  unknown escapes and a bare `\x`, `\u` or `\U` keep their backslash. */
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

const HEX_DIGITS = new Map<string, RegExp>([
  ["x", /[0-9a-f]{1,2}/iy],
  ["u", /[0-9a-f]{1,4}/iy],
  ["U", /[0-9a-f]{1,8}/iy],
]);

const OCTAL_DIGITS = /[0-7]{1,3}/y;

/** The decoded escape whose backslash is at `index`, and the index just past it. */
function decodeAnsiCEscape(
  inner: string,
  index: number,
  dialect: AnsiCDialect,
): { text: string; end: number } {
  const escaped = inner.charAt(index + 1);
  const simple = ANSI_C_SIMPLE_ESCAPES[escaped];
  if (simple !== undefined) return { text: simple, end: index + 2 };
  if (/^[0-7]$/.test(escaped)) {
    const digits = digitsAt(inner, index + 1, OCTAL_DIGITS);
    const text = String.fromCharCode(Number.parseInt(digits, 8) & 0xff);
    return { text, end: index + 1 + digits.length };
  }
  if (escaped === "c" && dialect === "bash") {
    return decodeAnsiCControl(inner, index);
  }
  const hex = HEX_DIGITS.get(escaped);
  const decoded = hex && decodeAnsiCHex(inner, index, escaped, hex);
  if (decoded) return decoded;
  if (dialect === "zsh") return decodeZshOther(inner, index, escaped);
  return { text: `\\${escaped}`, end: index + 2 };
}

/** The `\x`, `\u` or `\U` escape at `index`; undefined without a hex digit. */
function decodeAnsiCHex(
  inner: string,
  index: number,
  letter: string,
  pattern: RegExp,
): { text: string; end: number } | undefined {
  const digits = digitsAt(inner, index + 2, pattern);
  if (digits === "") return undefined;
  const end = index + 2 + digits.length;
  const value = Number.parseInt(digits, 16);
  if (letter === "x") return { text: String.fromCharCode(value), end };
  return { text: codePointText(value), end };
}

/** The text bash gives a `\u` or `\U` code point. Values above 0x7fffffff
 *  are dropped; surrogates and values past U+10FFFF are not JavaScript code
 *  points and become U+FFFD. */
function codePointText(value: number): string {
  if (value > 0x7fffffff) return "";
  if ((value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff) return "\ufffd";
  return String.fromCodePoint(value);
}

/** `\cX` is the control character of X, `\c?` is DEL, and `\c\\` is the
 *  control character of a backslash. */
function decodeAnsiCControl(
  inner: string,
  index: number,
): { text: string; end: number } {
  const target = inner.charAt(index + 2);
  if (target === "") return { text: "\\c", end: index + 2 };
  if (target === "\\") {
    const end = inner.charAt(index + 3) === "\\" ? index + 4 : index + 3;
    return { text: "\x1c", end };
  }
  const code = target === "?" ? 0x7f : target.charCodeAt(0) & 0x1f;
  return { text: String.fromCharCode(code), end: index + 3 };
}

/** The digits matched by the sticky `pattern` at `start`. */
function digitsAt(text: string, start: number, pattern: RegExp): string {
  pattern.lastIndex = start;
  return pattern.exec(text)?.[0] ?? "";
}
