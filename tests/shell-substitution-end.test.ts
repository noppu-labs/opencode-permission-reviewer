import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { substitutionAt } from "../src/shell-substitution.ts";
import { substitutionBodyEnd } from "../src/shell-substitution-end.ts";

const BRACE = "$" + "{";

/** `text: [index just past the opener, opener, index of the closing character
 *  in bash 5.3 (3.2, 4.4 and 5.1 agree), the index the previous scan gives]`,
 *  one row per line in tests/fixtures/substitution-end-rows.json. */
const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/substitution-end-rows.json"),
    "utf8",
  ),
) as Record<string, [number, "command" | "backtick", number, number]>;
const rows = Object.entries(fixture).map(
  ([text, [start, opener, end, previous]]) =>
    [text, start, opener, end, previous] as const,
);

describe("substitutionBodyEnd", () => {
  test.each(rows)(
    "ends the body of %j where the shell ends it",
    (text, start, opener, end) => {
      expect(substitutionBodyEnd(text, start, opener, "default", "bash")).toBe(
        end,
      );
    },
  );

  test.each(rows)(
    "keeps the previous end for %j",
    (text, start, opener, _end, previous) => {
      expect(
        substitutionBodyEnd(text, start, opener, "default", "previous"),
      ).toBe(previous);
    },
  );

  test("defaults to the shell's end", () => {
    const [text, start, opener, end] = rows[0] ?? ["", 0, "command", 0];
    expect(substitutionBodyEnd(text, start, opener)).toBe(end);
  });

  test("ends at the end of the input when nothing closes the body", () => {
    const text = `"$(echo ${BRACE}x:-"a)"} `;
    expect(substitutionBodyEnd(text, 3, "command", "default", "bash")).toBe(
      text.length,
    );
  });

  test("scans a long run of nested quoted expansions once", () => {
    const body = `echo "${BRACE}x:-"a)"}" ; `.repeat(6553);
    const text = `"$(${body})"`;
    const started = performance.now();
    expect(substitutionBodyEnd(text, 3, "command", "default", "bash")).toBe(
      3 + body.length,
    );
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("substitutionAt", () => {
  test.each(rows)(
    "passes the scan version through for %j",
    (text, start, opener, end, previous) => {
      const index = start - (opener === "command" ? 2 : 1);
      expect(
        substitutionAt(text, index, true, false, "default", "bash"),
      ).toMatchObject({ end: end + 1 });
      expect(
        substitutionAt(text, index, true, false, "default", "previous"),
      ).toMatchObject({ end: previous + 1 });
    },
  );
});
