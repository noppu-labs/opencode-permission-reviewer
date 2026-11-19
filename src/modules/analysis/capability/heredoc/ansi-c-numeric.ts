// The `$'...'` escapes that give a character by number: octal, `\x`, `\u`,
// `\U` and `\cX`.

import type { AnsiCDialect } from "./ansi-c-quoting.ts";
import type { DecodedEscape } from "./ansi-c-zsh.ts";

const HEX_DIGITS = new Map<string, RegExp>([
  ["x", /[0-9a-f]{1,2}/iy],
  ["u", /[0-9a-f]{1,4}/iy],
  ["U", /[0-9a-f]{1,8}/iy],
]);

const OCTAL_DIGITS = /[0-7]{1,3}/y;

/** The octal escape at `index`, whose first digit is at `index + 1`. */
export function decodeAnsiCOctal(inner: string, index: number): DecodedEscape {
  const digits = digitsAt(inner, index + 1, OCTAL_DIGITS);
  const text = String.fromCharCode(Number.parseInt(digits, 8) & 0xff);
  return { text, end: index + 1 + digits.length };
}

/** The `\x`, `\u` or `\U` escape at `index`; undefined for another letter or
 *  without a hex digit. */
export function decodeAnsiCHex(
  inner: string,
  index: number,
  letter: string,
): DecodedEscape | undefined {
  const pattern = HEX_DIGITS.get(letter);
  if (pattern === undefined) return undefined;
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
  if ((value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff) return "�";
  return String.fromCodePoint(value);
}

/** `\cX` is the control character of X. In bash 4.4 and later `\c?` is DEL and
 *  `\c\\` takes both backslashes; bash 3.2 reads each like any other X. */
export function decodeAnsiCControl(
  inner: string,
  index: number,
  dialect: AnsiCDialect,
): DecodedEscape {
  const target = inner.charAt(index + 2);
  if (target === "") return { text: "\\c", end: index + 2 };
  const modern = dialect === "bash";
  if (target === "\\" && modern) {
    const end = inner.charAt(index + 3) === "\\" ? index + 4 : index + 3;
    return { text: "\x1c", end };
  }
  const code = target === "?" && modern ? 0x7f : target.charCodeAt(0) & 0x1f;
  return { text: String.fromCharCode(code), end: index + 3 };
}

/** The digits matched by the sticky `pattern` at `start`. */
function digitsAt(text: string, start: number, pattern: RegExp): string {
  pattern.lastIndex = start;
  return pattern.exec(text)?.[0] ?? "";
}
