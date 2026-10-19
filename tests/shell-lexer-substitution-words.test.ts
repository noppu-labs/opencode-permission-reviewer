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

describe("an expansion in double quotes", () => {
  const OPEN = "$" + "{";

  test("is one word, with the text as written", () => {
    const token = scan(`echo "${OPEN}x:-"a b"}"c`)[0]?.tokens[1];
    expect(token).toEqual({
      raw: `"${OPEN}x:-"a b"}"c`,
      value: `${OPEN}x:-"a b"}c`,
      spans: [
        { text: `${OPEN}x:-"a b"}`, quoted: true },
        { text: "c", quoted: false },
      ],
    });
  });

  test("lexes a command inside it once, even between single quotes", () => {
    const segments = scan(`echo "${OPEN}x:-'$(a)'}" ; c`);
    expect(segments.map((segment) => segment.tokens[0]?.value)).toEqual([
      "echo",
      "a",
      "c",
    ]);
  });

  test("lexes a command in a nested expansion once", () => {
    const segments = scan(`echo "${OPEN}x:-${OPEN}y:-$(a)}}"`);
    expect(segments.map((segment) => segment.tokens[0]?.value)).toEqual([
      "echo",
      "a",
    ]);
  });

  test("reads an unterminated one to the end of the input", () => {
    const segments = scan(`echo "${OPEN}x:-a ; echo RAN`);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.tokens[1]?.value).toBe(`${OPEN}x:-a ; echo RAN`);
  });

  test("keeps the previous reading after a `$$`, where shells disagree", () => {
    const command = `echo "$${OPEN}x:-"a b"}" ; echo RAN`;
    expect(render(scan(command))).toBe(render(scan(command, "rescan")));
    expect(scan(command)[0]?.tokens).toHaveLength(3);
  });

  test("is not an expansion when the `$` is escaped", () => {
    const command = `echo "\\${OPEN}x:-"a b"}"`;
    expect(render(scan(command))).toBe(render(scan(command, "rescan")));
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
  const OPEN = "$" + "{";
  const nestedExpansions = (depth: number): string =>
    `echo "${`${OPEN}x:-"`.repeat(depth)}a${'"}'.repeat(depth)}" ; echo RAN`;
  const nestedPlainExpansions = (depth: number): string =>
    `echo "${`${OPEN}x:-${OPEN}y:-`.repeat(depth)}a${"}}".repeat(depth)}" ; echo RAN`;
  const manyExpansions = (count: number): string =>
    `echo ${`"${OPEN}x:-"a b"}" `.repeat(count)}; echo RAN`;
  const expansionsWithCommands = (count: number): string =>
    `echo "${`${OPEN}x:-$(x)}`.repeat(count)}" ; echo RAN`;
  const manyArithmetics = (count: number): string =>
    `echo "${`${OPEN}x:-${"$((1)) ".repeat(count)}}`}" ; echo RAN`;
  const manySubshells = (count: number): string =>
    `echo "${`${OPEN}x:-${"$((a) )".repeat(count)}}`}" ; echo RAN`;
  const manyInArithmetic = (count: number): string =>
    `echo "$(( ${"$((1)) + ".repeat(count)}1 ))" ; echo RAN`;
  const nestedArithmetics = (depth: number): string =>
    `echo "$(( ${"$(( ".repeat(depth)}1${" ))".repeat(depth)} ))" ; echo RAN`;
  const unterminated = (count: number): string =>
    `echo "${`${OPEN}x:-`.repeat(count)}`;

  function timed(command: string): { segments: ShellSegment[]; ms: number } {
    const start = performance.now();
    const segments = scan(command);
    return { segments, ms: performance.now() - start };
  }

  test.each([
    ["many quoted substitutions at the cap", many(CAP)],
    ["many quoted substitutions at 8x the cap", many(8 * CAP)],
    ["one body with many quotes at the cap", quotes(CAP)],
    ["one body with many quotes at 8x the cap", quotes(8 * CAP)],
    ["nested substitutions past the budget", nested(1600)],
    ["nested substitutions at the cap", nested(Math.floor(CAP / 14))],
    ["nested substitutions at 8x the cap", nested(Math.floor((8 * CAP) / 14))],
    ["unterminated expansions at the cap", unterminated(Math.floor(CAP / 6))],
    [
      "unterminated expansions at 8x the cap",
      unterminated(Math.floor((8 * CAP) / 6)),
    ],
  ])("lexes %s in under a second", (_name, command) => {
    expect(timed(command).ms).toBeLessThan(1000);
  });

  test.each([100, 150])(
    "lexes each body of %d nested substitutions once",
    (depth) => {
      const { segments, ms } = timed(nested(depth));
      expect(segments).toHaveLength(depth + 1);
      expect(ms).toBeLessThan(1000);
    },
  );

  test("stops at the substitution budget with nothing lexed twice", () => {
    expect(scan(nested(Math.floor(CAP / 14)))).toHaveLength(0);
  });

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])("keeps nested expansions %s in one word", (_name, size) => {
    for (const command of [
      nestedExpansions(Math.floor(size / 12)),
      nestedPlainExpansions(Math.floor(size / 14)),
    ]) {
      const { segments, ms } = timed(command);
      expect(segments).toHaveLength(2);
      expect(segments[0]?.tokens).toHaveLength(2);
      expect(ms).toBeLessThan(1000);
    }
  });

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])("reads one word per expansion %s", (_name, size) => {
    const count = Math.floor(size / 16);
    const { segments, ms } = timed(manyExpansions(count));
    expect(segments).toHaveLength(2);
    expect(segments[0]?.tokens).toHaveLength(count + 1);
    expect(ms).toBeLessThan(1000);
  });

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])("lexes the command in each expansion once %s", (_name, size) => {
    const count = Math.floor(size / 12);
    const { segments, ms } = timed(expansionsWithCommands(count));
    expect(segments).toHaveLength(count + 2);
    expect(ms).toBeLessThan(1000);
  });

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])("reads many arithmetic expansions in one expansion %s", (_name, size) => {
    const { segments, ms } = timed(manyArithmetics(Math.floor(size / 7)));
    expect(segments).toHaveLength(2);
    expect(ms).toBeLessThan(1000);
  });

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])("lexes many subshell substitutions in one expansion %s", (_name, size) => {
    const count = Math.floor(size / 20);
    const { segments, ms } = timed(manySubshells(count));
    expect(segments).toHaveLength(2 * count + 2);
    expect(ms).toBeLessThan(1000);
  });

  test("reads many arithmetic expansions in one arithmetic expansion at the cap", () => {
    const { segments, ms } = timed(manyInArithmetic(Math.floor(CAP / 9)));
    expect(segments).toHaveLength(2);
    expect(ms).toBeLessThan(1000);
  });

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])("reads nested arithmetic expansions %s", (_name, size) => {
    const { segments, ms } = timed(nestedArithmetics(Math.floor(size / 8)));
    expect(segments).toHaveLength(2);
    expect(ms).toBeLessThan(1000);
  });

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])(
    "finds a subshell substitution under nested arithmetic %s",
    (_name, size) => {
      const depth = Math.floor(size / 8);
      const command = `echo "$(( ${"$(( ".repeat(depth)}$((a) )${" ))".repeat(depth)} ))" ; echo RAN`;
      const { segments, ms } = timed(command);
      expect(segments.map((segment) => segment.tokens[0]?.value)).toEqual([
        "echo",
        undefined,
        "a",
        "echo",
      ]);
      expect(ms).toBeLessThan(1000);
    },
  );
  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])(
    "reads many subshells that open with two parentheses and hold a heredoc %s",
    (_name, size) => {
      const unit = 'echo "$( ((a <<E\n(((\nE\n )) )" ;\n';
      const { ms } = timed(unit.repeat(Math.floor(size / unit.length)));
      expect(ms).toBeLessThan(1000);
    },
  );

  test.each([
    ["at the cap", CAP],
    ["at 8x the cap", 8 * CAP],
  ])("reads many opening parentheses in substitutions %s", (_name, size) => {
    const unit = 'echo "$( ((( x )" ;\n';
    const { ms } = timed(unit.repeat(Math.floor(size / unit.length)));
    expect(ms).toBeLessThan(1000);
  });
  test.each([
    ["short padding", 10],
    ["long padding", 100],
    ["very long padding", 5000],
  ])(
    "reads a double parenthesis after nested arithmetic with %s the same",
    (_name, pad) => {
      const nest = `echo "$(( ((${" ".repeat(pad)}1)) ))" ;\n`;
      const command = `${nest.repeat(3)}echo "$( (( case = 1 )); echo A)" ; echo hi`;
      const last = scan(command).at(-1);
      expect(last?.tokens.map((token) => token.value)).toEqual(["echo", "hi"]);
    },
  );

  const deepThenCase = (size: number): string => {
    const depth = Math.floor(size / 12);
    return `echo "$( ${"(( ".repeat(depth)}1${" ))".repeat(depth)} )" ;\necho "$( (( case = 1 )); echo A)" ; echo hi`;
  };

  test("reads a double parenthesis after deep nested arithmetic commands at the cap", () => {
    const { segments, ms } = timed(deepThenCase(CAP));
    expect(segments.at(-1)?.tokens.map((token) => token.value)).toEqual([
      "echo",
      "hi",
    ]);
    expect(ms).toBeLessThan(1000);
  });

  test("reads deep nested arithmetic commands at 8x the cap in under a second", () => {
    expect(timed(deepThenCase(8 * CAP)).ms).toBeLessThan(1000);
  });
});
