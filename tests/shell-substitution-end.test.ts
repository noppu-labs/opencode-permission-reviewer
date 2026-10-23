import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { substitutionAt } from "../src/modules/analysis/shell/shell-substitution.ts";
import { substitutionBodyEnd } from "../src/modules/analysis/shell/shell-substitution-end.ts";

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

  test("reads time after a pipe as a word and after || as a keyword", () => {
    const piped = '"$(echo a | time case x in x) echo B;; esac)"';
    const listed = '"$(echo a || time case x in x) echo B;; esac)"';
    expect(substitutionBodyEnd(piped, 3, "command")).toBe(piped.indexOf(")"));
    expect(substitutionBodyEnd(listed, 3, "command")).toBe(listed.length - 2);
  });

  test("reads $$ as one parameter before a brace", () => {
    const text = `"$(echo $${BRACE}x:-)})"`;
    expect(substitutionBodyEnd(text, 3, "command")).toBe(text.indexOf(")"));
    expect(substitutionBodyEnd(text, 3, "command", "default", "previous")).toBe(
      text.indexOf(")"),
    );
  });

  test.each([
    "function a-b { case x in x) echo A;; esac; }; a-b",
    "function a.b () { case x in x) echo A;; esac; }; a.b",
    "function a:b case x in x) echo A;; esac; a:b",
    "function 1a case x in x) echo A;; esac; 1a",
    "function a+b () { case x in x) echo A;; esac; }; a+b",
  ])("reads the name after function as one word in %j", (body) => {
    const text = `"$(${body})"`;
    expect(substitutionBodyEnd(text, 3, "command")).toBe(text.length - 2);
    expect(substitutionBodyEnd(text, 3, "command", "default", "previous")).toBe(
      text.indexOf("x)") + 1,
    );
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
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe("a double parenthesis", () => {
  const SUBSTITUTION = "$( (( case = 1 )); echo A)";
  const ALPHABET = [
    '"',
    "'",
    "`",
    "(",
    ")",
    "((",
    "))",
    "$(",
    "$((",
    "${",
    "}",
    " ",
    " ",
    "\n",
    "\\",
    "#",
    ";",
    "&&",
    "x",
    "a",
    "case ",
    "<<E\n",
    "E\n",
    "[[ ",
    " ]]",
    "x=(",
    "for w in ",
    "; do ",
    "done",
    "))",
    "$(( (( ",
    " 1 ",
    "(((",
  ];

  function prefixes(count: number): string[] {
    let seed = 7;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    return Array.from({ length: count }, () => {
      let text = "";
      for (let i = next(40); i > 0; i -= 1)
        text += ALPHABET[next(ALPHABET.length)];
      return text;
    });
  }

  test("is read the same wherever it stands", () => {
    const alone = substitutionBodyEnd(SUBSTITUTION, 2, "command") - 2;
    expect(alone).toBeGreaterThan(0);
    for (const prefix of prefixes(3000)) {
      const text = prefix + SUBSTITUTION;
      const at = prefix.length + 2;
      expect(substitutionBodyEnd(text, at, "command") - at).toBe(alone);
    }
  });

  test("is read the same after a run of nested arithmetic", () => {
    const nest = `echo "$(( ((${" ".repeat(200)}1)) ))" ;\n`;
    for (const copies of [1, 3, 20]) {
      const prefix = nest.repeat(copies);
      const at = prefix.length + 2;
      expect(
        substitutionBodyEnd(prefix + SUBSTITUTION, at, "command") - at,
      ).toBe(substitutionBodyEnd(SUBSTITUTION, 2, "command") - 2);
    }
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

/** `text: [index just past the opener, index of the closing brace]` for a
 *  `${…}` in double quotes, from bash 3.2, 4.4, 5.1 and 5.3 (all agree), one
 *  row per line in tests/fixtures/expansion-end-rows.json. */
const EXPANSIONS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/expansion-end-rows.json"),
    "utf8",
  ),
) as Record<string, [number, number]>;

describe("substitutionBodyEnd of a braced expansion", () => {
  test.each(Object.entries(EXPANSIONS))(
    "ends %j at its closing brace",
    (text, [start, end]) => {
      expect(substitutionBodyEnd(text, start, "brace")).toBe(end);
    },
  );

  test("ends at the end of the text when nothing closes it", () => {
    const text = '"${x:-"a b"';
    expect(substitutionBodyEnd(text, 3, "brace")).toBe(text.length);
  });
});
