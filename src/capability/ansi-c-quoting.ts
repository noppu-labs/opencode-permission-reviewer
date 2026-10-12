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
