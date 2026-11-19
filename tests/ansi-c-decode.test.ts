import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ansiCShellDependent,
  decodeAnsiCWord,
  unescapeAnsiC,
} from "../src/modules/analysis/capability/heredoc/ansi-c-quoting.ts";

/** [text between `$'` and the closing `'`, bash's value, the heredoc-delimiter
 *  reading from `unescapeAnsiC`], one row per line in
 *  tests/fixtures/ansi-c-decode-rows.json. Values are bash 5.3 (4.4 and 5.1 agree;
 *  3.2 keeps `\u`/`\U` literal and differs on `\c?` and `\c\\`). */
const rows = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/ansi-c-decode-rows.json"),
    "utf8",
  ),
) as [string, string, string][];

describe("decodeAnsiCWord", () => {
  test.each(rows)("decodes %j to bash's value", (inner, decoded) => {
    expect(decodeAnsiCWord(inner)).toBe(decoded);
  });

  test("runs in linear time on many escapes", () => {
    expect(decodeAnsiCWord("\\x41".repeat(100000))).toBe("A".repeat(100000));
  });
});

describe("ansiCShellDependent", () => {
  test.each([
    "\\a",
    "\\t",
    "\\\\",
    "\\'",
    '\\"',
    "\\?",
    "\\101",
    "\\777",
    "\\x41",
    "\\x4",
    // A NUL that ends the word gives the same argument in both.
    "\\0",
    "a\\x00",
    "plain",
    "",
  ])("reads %j the same in bash, bash 3.2 and zsh", (inner) => {
    expect(ansiCShellDependent(inner)).toBe(false);
  });
  test.each([
    "\\[",
    "r\\m",
    "\\-delete",
    "\\/",
    "\\ ",
    "a\\\nb",
    "\\q",
    "\\cA",
    "\\c",
    "\\x",
    "\\xg",
    "\\u",
    "\\U",
    "\\Ca",
    "\\M-a",
    "\\033\\[?1049h",
    "a\\",
    // bash 3.2 keeps `\u` and `\U` literally.
    "\\u0072",
    "\\U0001F600",
    // bash ends the word at a NUL; zsh keeps the rest.
    "a\\x00b",
    "\\0;",
    "\\0\\0",
  ])("reads %j differently in bash, bash 3.2 or zsh", (inner) => {
    expect(ansiCShellDependent(inner)).toBe(true);
  });

  test("runs in linear time on many escapes", () => {
    expect(ansiCShellDependent("\\x41".repeat(100000))).toBe(false);
    expect(ansiCShellDependent("\\101".repeat(100000))).toBe(false);
  });
});

describe("decodeAnsiCWord zsh", () => {
  test.each([
    ["\\[", "["],
    ["r\\m", "rm"],
    ["\\-delete", "-delete"],
    ["a\\ b", "a b"],
    ["a\\\nb", "a\nb"],
    ["\\ca", "ca"],
    ["\\c", "c"],
    ["a\\xz", "a"],
    ["a\\uz", "a"],
    ["a\\Uz", "a"],
    ["x\\Caz", "x\u0001z"],
    ["x\\C-az", "x\u0001z"],
    ["x\\M-az", "xáz"],
    ["x\\Maz", "xáz"],
    ["\\x41", "A"],
    ["\\101", "A"],
    ["\\u00e9", "é"],
    ["\\t", "\t"],
    ["a\\c\\\\z", "ac\\z"],
    ["a\\C\\\\z", "a\u001cz"],
    ["a\\M\\\\z", "aÜz"],
    ["a\\C-\\\\z", "a\u001cz"],
    // A modifier applies to the escape after it, innermost first.
    ["\\M-\\C-a", "\x81"],
    ["\\C-\\M-a", "\x81"],
    ["\\C-?", "\x7f"],
    ["\\C-\\M-?", "\x9f"],
    ["\\M-\\C-?", "\xff"],
    ["\\C-\\C-a", "\x01"],
    ["\\C-\\x4a", "\n"],
    ["\\C-\\101", "\x01"],
    ["\\C-\\q", "\x11"],
    ["\\C--", "\r"],
    ["a\\C-", "a"],
    ["a\\M", "a"],
    ["echo hi\\0; rm", "echo hi"],
    ["a\\C-\\xz", "a"],
  ])("decodes %j to zsh's value %j", (inner, value) => {
    expect(decodeAnsiCWord(inner, "zsh")).toBe(value);
  });

  test("runs in linear time on a long modifier run", () => {
    expect(decodeAnsiCWord(`${"\\C-".repeat(40000)}a`, "zsh")).toBe("\x01");
  });
  test.each(rows)("keeps bash's value of %j by default", (inner, decoded) => {
    expect(decodeAnsiCWord(inner, "bash")).toBe(decoded);
  });
});

describe("decodeAnsiCWord bash 3.2", () => {
  test.each([
    ["\\u0027", "\\u0027"],
    ["\\U00000041", "\\U00000041"],
    ["\\x41", "A"],
    ["\\c?", "\x1f"],
    ["\\c\\\\a", "\x1c\x07"],
    ["a\\0b", "a"],
  ])("decodes %j to bash 3.2's value %j", (inner, value) => {
    expect(decodeAnsiCWord(inner, "bash32")).toBe(value);
  });
});

describe("unescapeAnsiC", () => {
  test.each(rows)("keeps the heredoc reading of %j", (inner, _, legacy) => {
    expect(unescapeAnsiC(inner, 0).text).toBe(legacy);
  });
});
