import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractHeredocs } from "../src/capability/heredoc-extractor.ts";
import {
  type LexBudget,
  MAX_SUBSTITUTION_CHARS,
  type ShellQuoting,
} from "../src/shell-lex-state.ts";
import { normalizeShellRedirections } from "../src/shell-redirections.ts";
import { lexSegments } from "../src/shell-scanner.ts";
import {
  hasQuotedChar,
  type ShellSegment,
  sliceToken,
  tokenCharIsQuoted,
} from "../src/shell-token.ts";

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
) as Record<
  | "bash"
  | "outer"
  | "rescan"
  | "undecoded"
  | "previous"
  | "redirections"
  | "redirectionsRescan",
  Rows
>;

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

  test("keeps an unquoted backtick form in an unquoted span of its own", () => {
    const token = scan("echo a`b c`d")[0]?.tokens[1];
    expect(token).toEqual({
      raw: "a`b c`d",
      value: "a`b c`d",
      spans: [
        { text: "a", quoted: false },
        { text: "`b c`", quoted: false, opaque: true },
        { text: "d", quoted: false },
      ],
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

  test("reads an unterminated one and the text after it as the previous release did", () => {
    for (const command of [
      `echo "${OPEN}x:-a ; echo RAN`,
      `echo "$(echo a ; echo RAN`,
      `true || x="$(echo A #c)"; echo RAN`,
      `echo "$(( 1 + 2 ; echo RAN`,
    ])
      expect(render(scan(command))).toBe(render(scan(command, "rescan")));
  });

  test("reads the commands after a heredoc the extractor collapsed", () => {
    const command = extractHeredocs(
      `echo "${OPEN}x:-"$(cat <<E\nx\nE\n)"}" ; echo RAN`,
    ).sanitizedCommand;
    expect(
      scan(command)
        .at(-1)
        ?.tokens.map((token) => token.value),
    ).toEqual(["echo", "RAN"]);
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

/** The words and redirections of the first segment, as `value ¦ value` and
 *  `operator target ¦ operator target`. */
function splitFirst(command: string, quoting?: ShellQuoting): [string, string] {
  const tokens = scan(command, quoting)[0]?.tokens ?? [];
  const split = normalizeShellRedirections(tokens);
  return [
    split.tokens.map((token) => token.value).join(" ¦ "),
    split.redirections
      .map((found) => `${found.operator} ${found.target}`)
      .join(" ¦ "),
  ];
}

// Text a substitution holds is not the outer command's: an operator in it
// does not redirect the outer command, and the outer operators after it do.
// `redirectionsRescan` is the previous release's split of the same inputs.
describe("the redirections of a word that holds a substitution", () => {
  test.each(Object.entries(ROWS.redirections))("splits %j", (command, row) => {
    expect(splitFirst(command)).toEqual(row);
    expect(splitFirst(command, "bash")).toEqual(row);
  });

  test.each(Object.entries(ROWS.redirectionsRescan))(
    "splits %j as the previous release did under the rescan reading",
    (command, row) => {
      expect(splitFirst(command, "rescan")).toEqual(row);
    },
  );

  test("keeps the text of an unquoted backtick form in a span of its own", () => {
    const token = scan("echo x`a>b`y>c")[0]?.tokens[1];
    expect(token?.spans).toEqual([
      { text: "x", quoted: false },
      { text: "`a>b`", quoted: false, opaque: true },
      { text: "y>c", quoted: false },
    ]);
  });

  test("keeps two adjacent backtick forms in one opaque span", () => {
    const token = scan("echo `a``b`")[0]?.tokens[1];
    expect(token?.spans).toEqual([
      { text: "`a``b`", quoted: false, opaque: true },
    ]);
  });

  test("leaves the text of the other readings in plain spans", () => {
    for (const quoting of ["rescan", "undecoded", "previous"] as const) {
      const spans = scan("echo x`a>b`y", quoting)[0]?.tokens.flatMap(
        (token) => token.spans ?? [],
      );
      expect(spans?.some((span) => "opaque" in span)).toBe(false);
    }
  });

  test("reads the text as unquoted for the checks of glob characters", () => {
    const token = scan("echo `a*`")[0]?.tokens[1];
    expect(token && tokenCharIsQuoted(token, 2)).toBe(false);
    expect(token && hasQuotedChar(token)).toBe(false);
  });

  test.each([
    ["echo `a`|cat", "echo ¦ `a` ¶ a ¶ cat"],
    ["echo `a|b`|cat", "echo ¦ `a|b` ¶ a ¶ b ¶ cat"],
    ["echo `a;b`;ls", "echo ¦ `a;b` ¶ a ¶ b ¶ ls"],
    ["echo >`a&b`&ls", "echo ¦ >`a&b` ¶ a ¶ b ¶ ls"],
  ])(
    "ends the outer command only at its own separator in %j",
    (command, source) => {
      expect(raws(scan(command))).toBe(source);
    },
  );

  test("keeps the flag when a word is sliced", () => {
    const token = scan("echo x`a>b`y>c")[0]?.tokens[1];
    const sliced = token && sliceToken(token, 1, 6);
    expect(sliced?.spans).toEqual([
      { text: "`a>b`", quoted: false, opaque: true },
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

  const repeated = (unit: string, size: number): string =>
    unit.repeat(Math.floor(size / unit.length));
  const deepThenCase = (size: number): string => {
    const depth = Math.floor(size / 12);
    return `echo "$( ${"(( ".repeat(depth)}1${" ))".repeat(depth)} )" ;\necho "$( (( case = 1 )); echo A)" ; echo hi`;
  };
  const deepQuotedThenCase = (size: number): string => {
    const depth = Math.floor(size / 20);
    return `echo "$( ${'(( "$x" + '.repeat(depth)}1${" ))".repeat(depth)} )" ;\necho "$( (( case + "$x" )); echo A)" ; echo hi`;
  };
  /** Past the cap the deep shapes run out of substitution budget, so only
   *  their time is checked there. */
  const endsWithEchoHi = (segments: ShellSegment[], size: number): void => {
    if (size > CAP) return;
    expect(segments.at(-1)?.tokens.map((token) => token.value)).toEqual([
      "echo",
      "hi",
    ]);
  };

  /** Shapes timed at the cap and at 8x the cap, each with what its
   *  segments must show, if anything. */
  const SHAPES: [
    string,
    (size: number) => string,
    ((segments: ShellSegment[], size: number) => void)?,
  ][] = [
    ["many quoted substitutions", many],
    ["one body with many quotes", quotes],
    [
      "nested substitutions",
      (size: number): string => nested(Math.floor(size / 14)),
    ],
    [
      "unterminated expansions",
      (size: number): string => unterminated(Math.floor(size / 6)),
    ],
    [
      "unterminated substitutions",
      (size: number): string =>
        `echo ${'"$(echo a #c '.repeat(Math.floor(size / 14))}`,
    ],
    [
      "unterminated expansions and substitutions",
      (size: number): string =>
        `echo ${`"${OPEN}x:-$(a `.repeat(Math.floor(size / 12))}`,
    ],
    [
      "unterminated arithmetic expansions",
      (size: number): string =>
        `echo ${'"$(( 1 '.repeat(Math.floor(size / 7))}`,
    ],
    [
      "collapsed heredocs in expansions",
      (size: number): string =>
        extractHeredocs(
          `echo "${OPEN}x:-"$(cat <<E\nx\nE\n)"}" ;\n`.repeat(
            Math.floor(size / 30),
          ),
        ).sanitizedCommand,
    ],
    [
      "nested expansions",
      (size: number): string => nestedExpansions(Math.floor(size / 12)),
      (segments: ShellSegment[]): void => {
        expect(segments).toHaveLength(2);
        expect(segments[0]?.tokens).toHaveLength(2);
      },
    ],
    [
      "nested plain expansions",
      (size: number): string => nestedPlainExpansions(Math.floor(size / 14)),
      (segments: ShellSegment[]): void => {
        expect(segments).toHaveLength(2);
        expect(segments[0]?.tokens).toHaveLength(2);
      },
    ],
    [
      "one word per expansion",
      (size: number): string => manyExpansions(Math.floor(size / 16)),
      (segments: ShellSegment[], size: number): void => {
        expect(segments).toHaveLength(2);
        expect(segments[0]?.tokens).toHaveLength(Math.floor(size / 16) + 1);
      },
    ],
    [
      "the command in each expansion once",
      (size: number): string => expansionsWithCommands(Math.floor(size / 12)),
      (segments: ShellSegment[], size: number): void =>
        expect(segments).toHaveLength(Math.floor(size / 12) + 2),
    ],
    [
      "many arithmetic expansions in one expansion",
      (size: number): string => manyArithmetics(Math.floor(size / 7)),
      (segments: ShellSegment[]): void => expect(segments).toHaveLength(2),
    ],
    [
      "many subshell substitutions in one expansion",
      (size: number): string => manySubshells(Math.floor(size / 20)),
      (segments: ShellSegment[], size: number): void =>
        expect(segments).toHaveLength(2 * Math.floor(size / 20) + 2),
    ],
    [
      "nested arithmetic expansions",
      (size: number): string => nestedArithmetics(Math.floor(size / 8)),
      (segments: ShellSegment[]): void => expect(segments).toHaveLength(2),
    ],
    [
      "a subshell substitution under nested arithmetic",
      (size: number): string => {
        const depth = Math.floor(size / 8);
        return `echo "$(( ${"$(( ".repeat(depth)}$((a) )${" ))".repeat(depth)} ))" ; echo RAN`;
      },
      (segments: ShellSegment[]): void =>
        expect(segments.map((segment) => segment.tokens[0]?.value)).toEqual([
          "echo",
          undefined,
          "a",
          "echo",
        ]),
    ],
    [
      "subshells that open with two parentheses and hold a heredoc",
      (size: number): string =>
        repeated('echo "$( ((a <<E\n(((\nE\n )) )" ;\n', size),
    ],
    [
      "opening parentheses in substitutions",
      (size: number): string => repeated('echo "$( ((( x )" ;\n', size),
    ],
    [
      "a double parenthesis after deep nested arithmetic commands",
      deepThenCase,
      endsWithEchoHi,
    ],
    [
      "quoted arithmetic after deep nested quoted arithmetic",
      deepQuotedThenCase,
      endsWithEchoHi,
    ],
  ];

  test.each(
    SHAPES.flatMap(([name, build, check]) => [
      [`${name} at the cap`, CAP, build, check] as const,
      [`${name} at 8x the cap`, 8 * CAP, build, check] as const,
    ]),
  )("lexes %s in bounded time", (_name, size, build, check) => {
    const { segments, ms } = timed(build(size));
    check?.(segments, size);
    expect(ms).toBeLessThan(3000);
  });

  test("lexes nested substitutions past the budget in bounded time", () => {
    expect(timed(nested(1600)).ms).toBeLessThan(3000);
  });

  test.each([100, 150])(
    "lexes each body of %d nested substitutions once",
    (depth) => {
      const { segments, ms } = timed(nested(depth));
      expect(segments).toHaveLength(depth + 1);
      expect(ms).toBeLessThan(3000);
    },
  );

  test("stops at the substitution budget with nothing lexed twice", () => {
    expect(scan(nested(Math.floor(CAP / 14)))).toHaveLength(0);
  });

  test("reads many arithmetic expansions in one arithmetic expansion at the cap", () => {
    const { segments, ms } = timed(manyInArithmetic(Math.floor(CAP / 9)));
    expect(segments).toHaveLength(2);
    expect(ms).toBeLessThan(3000);
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
});
