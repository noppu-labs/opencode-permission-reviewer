import { describe, expect, test } from "bun:test";
import {
  decodeAnsiCWord,
  unescapeAnsiC,
} from "../src/capability/ansi-c-quoting.ts";

/** [text between `$'` and the closing `'`, bash's value, the heredoc-delimiter
 *  reading from `unescapeAnsiC`]. Values are bash 5.3 (4.4 and 5.1 agree; 3.2
 *  keeps `\u`/`\U` literal and differs on `\c?` and `\c\\`). */
const rows: [string, string, string][] = [
  ["\\a", "\u0007", "\u0007"],
  ["\\b", "\b", "\b"],
  ["\\e", "\u001b", "\u001b"],
  ["\\E", "\u001b", "\u001b"],
  ["\\f", "\f", "\f"],
  ["\\n", "\n", "\n"],
  ["\\r", "\r", "\r"],
  ["\\t", "\t", "\t"],
  ["\\v", "\u000b", "\u000b"],
  ["\\\\", "\\", "\\"],
  ["\\'", "'", "'"],
  ['\\"', '"', '"'],
  ["\\?", "?", "?"],
  ["\\1", "\u0001", "\u0001"],
  ["\\12", "\n", "\n"],
  ["\\101", "A", "A"],
  ["\\400", "", "Ā"],
  ["\\0", "", "\u0000"],
  ["\\x41", "A", "A"],
  ["\\x4", "\u0004", "\u0004"],
  ["\\x", "\\x", "x"],
  ["\\xg", "\\xg", "xg"],
  ["\\x41g", "Ag", "Ag"],
  ["\\u0072", "r", "u0072"],
  ["\\u00e9", "é", "u00e9"],
  ["\\U0001F600", "😀", "U0001F600"],
  ["\\u41", "A", "u41"],
  ["\\u00411", "A1", "u00411"],
  ["\\U0000041", "A", "U0000041"],
  ["\\u", "\\u", "u"],
  ["\\U", "\\U", "U"],
  ["\\UFFFFFFFFx", "x", "UFFFFFFFFx"],
  ["\\U00110000", "\ufffd", "U00110000"],
  ["\\uD800", "\ufffd", "uD800"],
  ["\\cA", "\u0001", "cA"],
  ["\\c@", "", "c@"],
  ["\\c?", "\u007f", "c?"],
  ["\\c\\\\", "\u001c", "c\\"],
  ["\\c[", "\u001b", "c["],
  ["\\c ", "", "c "],
  ["\\cz", "\u001a", "cz"],
  ["\\c\\q", "\u001cq", "cq"],
  ["\\c\\x41", "\u001cx41", "cA"],
  ["\\q", "\\q", "q"],
  ["\\8", "\\8", "8"],
  ["a\\0b", "a", "a\u0000b"],
  ["a\\x00b", "a", "a\u0000b"],
  ["a\\u0000b", "a", "au0000b"],
  ["a\\", "a\\", "a"],
];

describe("decodeAnsiCWord", () => {
  test.each(rows)("decodes %j to bash's value", (inner, decoded) => {
    expect(decodeAnsiCWord(inner)).toBe(decoded);
  });

  test("runs in linear time on many escapes", () => {
    expect(decodeAnsiCWord("\\x41".repeat(100000))).toBe("A".repeat(100000));
  });
});

describe("unescapeAnsiC", () => {
  test.each(rows)("keeps the heredoc reading of %j", (inner, _, legacy) => {
    expect(unescapeAnsiC(inner, 0).text).toBe(legacy);
  });
});
