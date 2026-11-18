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
    "\\0",
    "\\101",
    "\\777",
    "\\x41",
    "\\x4",
    "\\u0072",
    "\\U0001F600",
    "plain",
    "",
  ])("reads %j the same in bash and zsh", (inner) => {
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
  ])("reads %j differently in bash and zsh", (inner) => {
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
  ])("decodes %j to zsh's value %j", (inner, value) => {
    expect(decodeAnsiCWord(inner, "zsh")).toBe(value);
  });
  test.each(rows)("keeps bash's value of %j by default", (inner, decoded) => {
    expect(decodeAnsiCWord(inner, "bash")).toBe(decoded);
  });
});

describe("unescapeAnsiC", () => {
  test.each(rows)("keeps the heredoc reading of %j", (inner, _, legacy) => {
    expect(unescapeAnsiC(inner, 0).text).toBe(legacy);
  });
});
