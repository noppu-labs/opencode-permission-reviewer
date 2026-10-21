// ANSI-C quoting (`$'...'`) as bash unescapes it in a heredoc delimiter word.

import { invariant } from "../invariant.ts";

/** Unescape an ANSI-C quoted region (`$'...'`), the subset bash defines for
 *  here-document delimiter words: standard escapes, `\xHH` hex, and up to
 *  three octal digits. Unknown escapes drop the backslash, like bash. A
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

/** The value bash gives a `$'...'` word whose text between the quotes is
 *  `inner`, as written: escapes decoded, cut at the first NUL. Unknown
 *  escapes and a bare `\x`, `\u` or `\U` keep their backslash. */
export function decodeAnsiCWord(inner: string): string {
  let value = "";
  let index = 0;
  while (index < inner.length) {
    if (inner.charAt(index) !== "\\" || index + 1 === inner.length) {
      value += inner.charAt(index);
      index += 1;
      continue;
    }
    const decoded = decodeAnsiCEscape(inner, index);
    value += decoded.text;
    index = decoded.end;
  }
  const nul = value.indexOf("\0");
  return nul === -1 ? value : value.slice(0, nul);
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
): { text: string; end: number } {
  const escaped = inner.charAt(index + 1);
  const simple = ANSI_C_SIMPLE_ESCAPES[escaped];
  if (simple !== undefined) return { text: simple, end: index + 2 };
  if (/^[0-7]$/.test(escaped)) {
    const digits = digitsAt(inner, index + 1, OCTAL_DIGITS);
    const value = Number.parseInt(digits, 8) & 0xff;
    return {
      text: String.fromCharCode(value),
      end: index + 1 + digits.length,
    };
  }
  if (escaped === "c") return decodeAnsiCControl(inner, index);
  const hex = HEX_DIGITS.get(escaped);
  if (hex !== undefined) return decodeAnsiCHex(inner, index, escaped, hex);
  return { text: `\\${escaped}`, end: index + 2 };
}

function decodeAnsiCHex(
  inner: string,
  index: number,
  letter: string,
  pattern: RegExp,
): { text: string; end: number } {
  const digits = digitsAt(inner, index + 2, pattern);
  if (digits === "") return { text: `\\${letter}`, end: index + 2 };
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
