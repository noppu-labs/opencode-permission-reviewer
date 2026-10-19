import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type LexBudget,
  MAX_SUBSTITUTION_CHARS,
  type ShellQuoting,
} from "../src/shell-lex-state.ts";
import { normalizeShellRedirections } from "../src/shell-redirections.ts";
import { lexSegments } from "../src/shell-scanner.ts";
import type { ShellSegment } from "../src/shell-token.ts";

function scan(command: string, quoting?: ShellQuoting): ShellSegment[] {
  const budget: LexBudget = {
    tokensRemaining: Number.POSITIVE_INFINITY,
    substitutions: "lex",
    substitutionCharsRemaining: MAX_SUBSTITUTION_CHARS,
    ...(quoting === undefined ? {} : { quoting }),
  };
  return lexSegments(command, budget);
}

/** Each token's spans, the quoted ones wrapped in « », tokens joined by ¦ and
 *  segments by ¶. */
function render(segments: ShellSegment[]): string {
  return segments
    .map((segment) =>
      segment.tokens
        .map((token) =>
          (token.spans ?? [])
            .map(({ text, quoted }) => (quoted ? `«${text}»` : text))
            .join(""),
        )
        .join(" ¦ "),
    )
    .join(" ¶ ");
}

/** The source text of each token, joined the same way. */
function raws(segments: ShellSegment[]): string {
  return segments
    .map((segment) => segment.tokens.map((token) => token.raw).join(" ¦ "))
    .join(" ¶ ");
}

type Rows = Record<string, [string, string]>;

/** `input: [render, raws]` per reading, one row per line in
 *  tests/fixtures/substitution-word-rows.json. `rescan`, `undecoded` and
 *  `previous` are pinned to the output of the release before the
 *  substitution body stopped being scanned twice. */
const ROWS = JSON.parse(
  readFileSync(
    join(import.meta.dir, "fixtures/substitution-word-rows.json"),
    "utf8",
  ),
) as Record<"bash" | "outer" | "rescan" | "undecoded" | "previous", Rows>;

describe.each([
  ["bash", ROWS.bash],
  ["rescan", ROWS.rescan],
  ["undecoded", ROWS.undecoded],
  ["previous", ROWS.previous],
] as const)("the %s reading of substitution words", (quoting, table) => {
  test.each(Object.entries(table))("lexes %j", (command, [spans, source]) => {
    const segments = scan(command, quoting);
    expect(render(segments)).toBe(spans);
    expect(raws(segments)).toBe(source);
  });
});

// Rows whose substitution body holds a braced parameter with quotes or a `)`: the word
// that holds the substitution and the command after it are read right. The
// segments of the body itself are not asserted.
describe("the word that holds a substitution with a braced parameter in its body", () => {
  test.each(Object.entries(ROWS.outer))(
    "lexes %j",
    (command, [spans, source]) => {
      const segments = scan(command);
      expect(render(segments.slice(0, 1))).toBe(spans);
      expect(raws(segments.slice(0, 1))).toBe(source);
      expect(segments.at(-1)?.tokens.map((token) => token.value)).toEqual([
        "echo",
        "RAN",
      ]);
    },
  );
});

describe("the default reading", () => {
  test("reads substitution words as bash's reading does", () => {
    for (const command of Object.keys(ROWS.bash))
      expect(render(scan(command))).toBe(render(scan(command, "bash")));
  });
});

describe("a substitution's text in a word", () => {
  test("keeps a quoted substitution as one word, with the text as written", () => {
    const segments = scan('echo "$(echo ")")" ; echo RAN');
    expect(segments).toHaveLength(3);
    expect(segments[0]?.tokens[1]).toEqual({
      raw: '"$(echo ")")"',
      value: '$(echo ")")',
      spans: [{ text: '$(echo ")")', quoted: true }],
    });
  });

  test("marks an unquoted backtick form unquoted", () => {
    const token = scan("echo a`b c`d")[0]?.tokens[1];
    expect(token).toEqual({
      raw: "a`b c`d",
      value: "a`b c`d",
      spans: [{ text: "a`b c`d", quoted: false }],
    });
  });

  test("keeps the parts of a word around the substitution in order", () => {
    const token = scan('echo a"$(b)"c')[0]?.tokens[1];
    expect(token?.spans).toEqual([
      { text: "a", quoted: false },
      { text: "$(b)", quoted: true },
      { text: "c", quoted: false },
    ]);
  });

  test("reads the next substitution right after one", () => {
    const segments = scan('echo "$(a)$(b)" ; c');
    expect(segments.map((segment) => segment.tokens[0]?.value)).toEqual([
      "echo",
      "a",
      "b",
      "c",
    ]);
  });

  test("lexes the commands in an arithmetic expression", () => {
    const segments = scan('echo "$(( $(a) + `b` ))" ; c');
    expect(segments.map((segment) => segment.tokens[0]?.value)).toEqual([
      "echo",
      "a",
      "b",
      "c",
    ]);
  });
});

describe("splitting a word that holds a substitution", () => {
  const CASES: [string, string[], [string, string][]][] = [
    ['echo "$(cat > f)" > out', ["echo", "$(cat > f)"], [[">", "out"]]],
    ['echo "$(echo ">")">out', ["echo", '$(echo ">")'], [[">", "out"]]],
    ['echo "$(echo "a|b;c")"', ["echo", '$(echo "a|b;c")'], []],
  ];
  test.each(CASES)("splits %j", (command, words, redirections) => {
    const segment = scan(command)[0];
    const split = normalizeShellRedirections(segment?.tokens ?? []);
    expect(split.tokens.map((token) => token.value)).toEqual(words);
    expect(
      split.redirections.map((found) => [found.operator, found.target]),
    ).toEqual(redirections);
  });
});

describe("work stays linear in the text", () => {
  const CAP = 131_072;
  const many = (size: number): string =>
    `echo ${'"$(x)" '.repeat(Math.floor(size / 7))}`;
  const quotes = (size: number): string =>
    `echo "$(echo ${'"a" '.repeat(Math.floor(size / 4))})"`;
  const nested = (depth: number): string =>
    `echo ${'"$(echo "a" '.repeat(depth)}x${')"'.repeat(depth)}`;

  test.each([
    ["many quoted substitutions at the cap", many(CAP)],
    ["many quoted substitutions at 8x the cap", many(8 * CAP)],
    ["one body with many quotes at the cap", quotes(CAP)],
    ["one body with many quotes at 8x the cap", quotes(8 * CAP)],
    ["nested substitutions below the budget", nested(100)],
    ["nested substitutions past the budget", nested(1600)],
  ])("lexes %s in under a second", (_name, command) => {
    const start = performance.now();
    scan(command);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
