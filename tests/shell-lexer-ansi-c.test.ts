import { describe, expect, test } from "bun:test";
import {
  type LexBudget,
  MAX_SUBSTITUTION_CHARS,
  type ShellQuoting,
} from "../src/shell-lex-state.ts";
import { lexSegments } from "../src/shell-scanner.ts";
import type { ShellSegment } from "../src/shell-token.ts";

function words(segments: ShellSegment[]): [string, string][][] {
  return segments.map((segment) =>
    segment.tokens.map((token) => [token.raw, token.value]),
  );
}

function scan(command: string, quoting?: ShellQuoting): ShellSegment[] {
  const budget: LexBudget = {
    tokensRemaining: Number.POSITIVE_INFINITY,
    substitutions: "lex",
    substitutionCharsRemaining: MAX_SUBSTITUTION_CHARS,
    ...(quoting === undefined ? {} : { quoting }),
  };
  return lexSegments(command, budget);
}

function expectEchoRan(segments: ShellSegment[]): void {
  expect(words(segments.slice(-1))).toEqual([
    [
      ["echo", "echo"],
      ["RAN", "RAN"],
    ],
  ]);
}

function expectWordThenEchoRan(
  command: string,
  tokenIndex: number,
  expected: { raw?: string; value: string },
): void {
  const segments = scan(command);
  expect(segments).toHaveLength(2);
  expect(segments[0]?.tokens[tokenIndex]).toMatchObject(expected);
  expectEchoRan(segments);
}

describe("ANSI-C quoted words", () => {
  test("ends a `$'…'` string at the first unescaped quote", () => {
    const segments = scan("echo $'a\\'b'; ls");
    expect(segments).toHaveLength(2);
    expect(segments[0]?.tokens[1]).toMatchObject({
      raw: "$'a\\'b'",
      value: "a'b",
    });
  });

  test("lexes the command substitution that follows an escaped quote", () => {
    const segments = scan("echo $'\\'' \"$(id)\"");
    const bodies = segments.map((segment) =>
      segment.tokens.map((token) => token.value).join(" "),
    );
    expect(bodies).toContain("id");
  });

  const wordValues: Record<string, string[]> = {
    "printf $'a\\tb\\n'": ["printf", "a\tb\n"],
    "echo \"$'a\\'\" b": ["echo", "$'a\\'", "b"],
    "echo \\$'a\\' b": ["echo", "$a\\", "b"],
    "echo $$'a\\' b": ["echo", "$$a\\", "b"],
    "echo $$$'a\\'b'": ["echo", "$$a'b"],
  };
  test.each(Object.entries(wordValues))(
    "reads the words of %s",
    (command, values) => {
      const segments = scan(command);
      expect(segments).toHaveLength(1);
      const tokens = segments[0]?.tokens ?? [];
      expect(tokens.map((token) => token.raw)).toEqual(command.split(" "));
      expect(tokens.map((token) => token.value)).toEqual(values);
    },
  );

  test("reads an unterminated `$'…` as quoted to the end", () => {
    expect(scan("$'a\\' ; ls")).toHaveLength(1);
  });

  test("lexes `$'…'` as a plain quote under the previous reading", () => {
    expect(words(scan("echo $'a\\'b'; ls", "previous"))).toEqual([
      [
        ["echo", "echo"],
        ["$'a\\'b'; ls", "$a\\b; ls"],
      ],
    ]);
  });

  test("lexes a long run of escaped quotes in linear time", () => {
    const command = "$'\\'".repeat(25000);
    const start = performance.now();
    scan(command);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("lexes a long run of empty quotes before a `$` in linear time", () => {
    const command = "$$''".repeat(50000);
    const start = performance.now();
    scan(command);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test.each([
    [
      "ends an ANSI-C string after an empty `$''` quote",
      "echo $''$'a\\'b'; echo RAN",
      1,
      { raw: "$''$'a\\'b'", value: "a'b" },
    ],
    [
      'ends an ANSI-C string after an empty `$""` quote',
      "echo $\"\"$'a\\'b'; echo RAN",
      1,
      { value: "a'b" },
    ],
    [
      "ends an ANSI-C string after an empty plain quote",
      "echo ''$'a\\'b'; echo RAN",
      1,
      { raw: "''$'a\\'b'", value: "a'b" },
    ],
    [
      "reads an odd run of `$` before a quote as ANSI-C",
      "echo $$$'x\\'y'; echo RAN",
      1,
      { value: "$$x'y" },
    ],
    [
      "reads an odd run of five `$` before a quote as ANSI-C",
      "echo $$$$$'x\\'y'; echo RAN",
      1,
      { value: "$$$$x'y" },
    ],
    [
      "keeps an even run of `$` before a quote as a plain quote",
      "echo $$$$'x'y'z'; echo RAN",
      1,
      { value: "$$$$xyz" },
    ],
    [
      "ends an ANSI-C string after a braced parameter",
      "echo \u0024{x}$'a\\'b'; echo RAN",
      1,
      { value: "\u0024{x}a'b" },
    ],
    [
      "keeps a `$` run across a backslash-newline before a quote",
      "printf '[%s]\\n' $\\\n$'a\\'b''; echo RAN",
      2,
      { value: "$$a\\b" },
    ],
    [
      "keeps a `$` run across several backslash-newlines before a quote",
      "printf '[%s]\\n' $\\\n\\\n$'a\\'b''; echo RAN",
      2,
      { value: "$$a\\b" },
    ],
  ])("%s", (_, command, tokenIndex, expected) => {
    expectWordThenEchoRan(command, tokenIndex, expected);
  });

  test("ends an ANSI-C string after an arithmetic expansion", () => {
    const segments = scan("echo x$((1))$'a\\'b'; echo RAN");
    const last = segments.at(-2)?.tokens.at(-1);
    expect(last).toMatchObject({ value: "a'b" });
    expectEchoRan(segments);
  });

  test("resets a `$` run at a backslash-carriage-return before a quote", () => {
    const segments = scan("printf '[%s]\\n' $\\\r$'a\\'b'; echo RAN");
    expect(segments).toHaveLength(2);
    expect(segments[0]?.tokens).toHaveLength(3);
    expectEchoRan(segments);
  });

  test("lexes `$'…'` after an empty quote as a plain quote under the previous reading", () => {
    expect(words(scan("echo $''$'a\\'b'; ls", "previous"))).toEqual([
      [
        ["echo", "echo"],
        ["$''$'a\\'b'; ls", "$$a\\b; ls"],
      ],
    ]);
  });
});

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

// Each token's spans, the quoted ones wrapped in « », tokens joined by ¦ and
// segments by ¶.
const BASH_READING: Record<string, string> = {
  "printf $'a\\nb'": "printf ¦ «a\nb»",
  "echo $'it\\'s'": "echo ¦ «it's»",
  'echo $"x"': "echo ¦ «x»",
  "r$'m'": "r«m»",
  "echo $'\\x3b' ls": "echo ¦ «;» ¦ ls",
  '$$"b"': "$$«b»",
  '"$"x""': "«$»x",
  "echo $'\\x7c' x": "echo ¦ «|» ¦ x",
  "echo $'\\x24HOME'": "echo ¦ «$HOME»",
  "read -d $'\\0' x": "read ¦ -d ¦  ¦ x",
  "echo $'a\\' ; ls": "echo ¦ «a' ; ls»",
  "echo $'a\\x41": "echo ¦ «aA»",
  'echo $$$"b"': "echo ¦ $$«b»",
  "echo ''$\"x\"": "echo ¦ «x»",
  'echo \\$"x"': "echo ¦ «$x»",
  "echo $'a'>$'b'": "echo ¦ «a»>«b»",
  "echo $'\\x3e'x": "echo ¦ «>»x",
  'echo $"a\\"b"': 'echo ¦ «a"b»',
  "echo $'a'$\"b\"$'\\n'": "echo ¦ «ab\n»",
  "echo hi >$''|rm -rf /": "echo ¦ hi ¦ >«» ¶ rm ¦ -rf ¦ /",
  "echo hi <$''&rm -rf /": "echo ¦ hi ¦ <«» ¶ rm ¦ -rf ¦ /",
  'echo >$""|printf RAN': "echo ¦ >«» ¶ printf ¦ RAN",
  "echo hi >$'\\0'|echo RAN": "echo ¦ hi ¦ >«» ¶ echo ¦ RAN",
  "echo hi >''|echo RAN": "echo ¦ hi ¦ >«» ¶ echo ¦ RAN",
  "echo hi <''&echo RAN": "echo ¦ hi ¦ <«» ¶ echo ¦ RAN",
  'echo hi >""|echo RAN': "echo ¦ hi ¦ >«» ¶ echo ¦ RAN",
  "echo hi >''|&echo RAN": "echo ¦ hi ¦ >«» ¶ echo ¦ RAN",
  "echo hi >|x|echo RAN": "echo ¦ hi ¦ >|x ¶ echo ¦ RAN",
  "echo hi >\\\n|x": "echo ¦ hi ¦ >|x",
  "echo hi >&2|echo RAN": "echo ¦ hi ¦ >&2 ¶ echo ¦ RAN",
  "echo hi 2>&1|echo RAN": "echo ¦ hi ¦ 2>&1 ¶ echo ¦ RAN",
  "echo hi &>x|echo RAN": "echo ¦ hi ¦ &>x ¶ echo ¦ RAN",
  "echo hi >'>'|echo RAN": "echo ¦ hi ¦ >«>» ¶ echo ¦ RAN",
  "$''|echo RAN": " ¶ echo ¦ RAN",
  "$'';echo RAN": " ¶ echo ¦ RAN",
};

const UNDECODED_READING: Record<string, string> = {
  "printf $'a\\nb'": "printf ¦ $«a\\nb»",
  "echo $'it\\'s'": "echo ¦ $«it\\'s»",
  'echo $"x"': "echo ¦ $«x»",
  "r$'m'": "r$«m»",
  "echo $'\\x3b' ls": "echo ¦ $«\\x3b» ¦ ls",
  '$$"b"': "$$«b»",
  '"$"x""': "«$»x",
  "echo $'\\x7c' x": "echo ¦ $«\\x7c» ¦ x",
  "echo $'\\x24HOME'": "echo ¦ $«\\x24HOME»",
  "read -d $'\\0' x": "read ¦ -d ¦ $«\\0» ¦ x",
  "echo $'a\\' ; ls": "echo ¦ $«a\\' ; ls»",
  "echo $'a\\x41": "echo ¦ $«a\\x41»",
  'echo $$$"b"': "echo ¦ $$$«b»",
  "echo ''$\"x\"": "echo ¦ $«x»",
  'echo \\$"x"': "echo ¦ «$x»",
  "echo $'a'>$'b'": "echo ¦ $«a»>$«b»",
  "echo $'\\x3e'x": "echo ¦ $«\\x3e»x",
  'echo $"a\\"b"': 'echo ¦ $«a"b»',
  "echo $'a'$\"b\"$'\\n'": "echo ¦ $«a»$«b»$«\\n»",
  "echo hi >$''|rm -rf /": "echo ¦ hi ¦ >$ ¶ rm ¦ -rf ¦ /",
  "echo hi <$''&rm -rf /": "echo ¦ hi ¦ <$ ¶ rm ¦ -rf ¦ /",
  'echo >$""|printf RAN': "echo ¦ >$ ¶ printf ¦ RAN",
  "echo hi >$'\\0'|echo RAN": "echo ¦ hi ¦ >$«\\0» ¶ echo ¦ RAN",
  "echo hi >''|echo RAN": "echo ¦ hi ¦ >|echo ¦ RAN",
  "echo hi <''&echo RAN": "echo ¦ hi ¦ <&echo ¦ RAN",
  'echo hi >""|echo RAN': "echo ¦ hi ¦ >|echo ¦ RAN",
  "echo hi >''|&echo RAN": "echo ¦ hi ¦ >| ¶ echo ¦ RAN",
  "echo hi >|x|echo RAN": "echo ¦ hi ¦ >|x ¶ echo ¦ RAN",
  "echo hi >\\\n|x": "echo ¦ hi ¦ >|x",
  "echo hi >&2|echo RAN": "echo ¦ hi ¦ >&2 ¶ echo ¦ RAN",
  "echo hi 2>&1|echo RAN": "echo ¦ hi ¦ 2>&1 ¶ echo ¦ RAN",
  "echo hi &>x|echo RAN": "echo ¦ hi ¦ &>x ¶ echo ¦ RAN",
  "echo hi >'>'|echo RAN": "echo ¦ hi ¦ >«>» ¶ echo ¦ RAN",
  "$''|echo RAN": "$ ¶ echo ¦ RAN",
  "$'';echo RAN": "$ ¶ echo ¦ RAN",
};

const PREVIOUS_READING: Record<string, string> = {
  "printf $'a\\nb'": "printf ¦ $«a\\nb»",
  "echo $'it\\'s'": "echo ¦ $«it\\»s",
  'echo $"x"': "echo ¦ $«x»",
  "r$'m'": "r$«m»",
  "echo $'\\x3b' ls": "echo ¦ $«\\x3b» ¦ ls",
  '$$"b"': "$$«b»",
  '"$"x""': "«$»x",
  "echo $'\\x7c' x": "echo ¦ $«\\x7c» ¦ x",
  "echo $'\\x24HOME'": "echo ¦ $«\\x24HOME»",
  "read -d $'\\0' x": "read ¦ -d ¦ $«\\0» ¦ x",
  "echo $'a\\' ; ls": "echo ¦ $«a\\» ¶ ls",
  "echo $'a\\x41": "echo ¦ $«a\\x41»",
  'echo $$$"b"': "echo ¦ $$$«b»",
  "echo ''$\"x\"": "echo ¦ $«x»",
  'echo \\$"x"': "echo ¦ «$x»",
  "echo $'a'>$'b'": "echo ¦ $«a»>$«b»",
  "echo $'\\x3e'x": "echo ¦ $«\\x3e»x",
  'echo $"a\\"b"': 'echo ¦ $«a"b»',
  "echo $'a'$\"b\"$'\\n'": "echo ¦ $«a»$«b»$«\\n»",
  "echo hi >$''|rm -rf /": "echo ¦ hi ¦ >$ ¶ rm ¦ -rf ¦ /",
  "echo hi <$''&rm -rf /": "echo ¦ hi ¦ <$ ¶ rm ¦ -rf ¦ /",
  'echo >$""|printf RAN': "echo ¦ >$ ¶ printf ¦ RAN",
  "echo hi >$'\\0'|echo RAN": "echo ¦ hi ¦ >$«\\0» ¶ echo ¦ RAN",
  "echo hi >''|echo RAN": "echo ¦ hi ¦ >|echo ¦ RAN",
  "echo hi <''&echo RAN": "echo ¦ hi ¦ <&echo ¦ RAN",
  'echo hi >""|echo RAN': "echo ¦ hi ¦ >|echo ¦ RAN",
  "echo hi >''|&echo RAN": "echo ¦ hi ¦ >| ¶ echo ¦ RAN",
  "echo hi >|x|echo RAN": "echo ¦ hi ¦ >|x ¶ echo ¦ RAN",
  "echo hi >\\\n|x": "echo ¦ hi ¦ >|x",
  "echo hi >&2|echo RAN": "echo ¦ hi ¦ >&2 ¶ echo ¦ RAN",
  "echo hi 2>&1|echo RAN": "echo ¦ hi ¦ 2>&1 ¶ echo ¦ RAN",
  "echo hi &>x|echo RAN": "echo ¦ hi ¦ &>x ¶ echo ¦ RAN",
  "echo hi >'>'|echo RAN": "echo ¦ hi ¦ >«>» ¶ echo ¦ RAN",
  "$''|echo RAN": "$ ¶ echo ¦ RAN",
  "$'';echo RAN": "$ ¶ echo ¦ RAN",
};

describe.each([
  ["bash", BASH_READING],
  ["undecoded", UNDECODED_READING],
  ["previous", PREVIOUS_READING],
] as const)("the %s reading of dollar-quoted words", (quoting, table) => {
  test.each(Object.entries(table))("lexes %s", (command, expected) => {
    expect(render(scan(command, quoting))).toBe(expected);
  });
});

describe("dollar-quoted word values", () => {
  test("reads the default reading as bash's", () => {
    for (const command of Object.keys(BASH_READING))
      expect(render(scan(command))).toBe(render(scan(command, "bash")));
  });

  test("keeps `r$'m'` as an unquoted and a quoted span", () => {
    expect(scan("r$'m'")[0]?.tokens[0]).toEqual({
      raw: "r$'m'",
      value: "rm",
      spans: [
        { text: "r", quoted: false },
        { text: "m", quoted: true },
      ],
    });
  });

  test("keeps the source text of a decoded word as written", () => {
    const token = scan("echo $'\\x3b'")[0]?.tokens[1];
    expect(token).toMatchObject({ raw: "$'\\x3b'", value: ";" });
  });

  test("keeps a decoded operator character in a quoted span", () => {
    const segments = scan("echo $'\\x3b' $'\\x7c' $'\\x26'>$'\\x3e'");
    expect(segments).toHaveLength(1);
    const tokens = segments[0]?.tokens.slice(1);
    expect(tokens?.map((token) => token.spans)).toEqual([
      [{ text: ";", quoted: true }],
      [{ text: "|", quoted: true }],
      [
        { text: "&", quoted: true },
        { text: ">", quoted: false },
        { text: ">", quoted: true },
      ],
    ]);
  });

  test("ends the value at a NUL and keeps the token", () => {
    expect(render(scan("rm -rf $'/\\0tmp'"))).toBe("rm ¦ -rf ¦ «/»");
  });

  test("decodes an unterminated string up to the end of the command", () => {
    expect(render(scan("echo $'a\\x41"))).toBe("echo ¦ «aA»");
  });

  test("lexes a long run of unterminated decoded strings in linear time", () => {
    const command = "$'\\x41".repeat(16000);
    const start = performance.now();
    scan(command);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("lexes a long run of decoded strings near the input cap in linear time", () => {
    const command = "\"$'\\x41".repeat(18000);
    const start = performance.now();
    scan(command);
    expect(performance.now() - start).toBeLessThan(1000);
  });
  test.each(["''", '""', "$''"])(
    "lexes a long word followed by many empty quotes %s in linear time",
    (quote) => {
      const command = "a".repeat(400000) + quote.repeat(400000 / quote.length);
      const start = performance.now();
      scan(command);
      expect(performance.now() - start).toBeLessThan(1000);
    },
  );
});
