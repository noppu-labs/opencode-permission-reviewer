import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
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

describe("unescapeAnsiC", () => {
  test.each(rows)("keeps the heredoc reading of %j", (inner, _, legacy) => {
    expect(unescapeAnsiC(inner, 0).text).toBe(legacy);
  });
});
