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
      value: "$a\\'b",
    });
  });

  test("keeps escape sequences verbatim in the value", () => {
    expect(words(scan("printf $'a\\tb\\n'"))).toEqual([
      [
        ["printf", "printf"],
        ["$'a\\tb\\n'", "$a\\tb\\n"],
      ],
    ]);
  });

  test("lexes the command substitution that follows an escaped quote", () => {
    const segments = scan("echo $'\\'' \"$(id)\"");
    const bodies = segments.map((segment) =>
      segment.tokens.map((token) => token.value).join(" "),
    );
    expect(bodies).toContain("id");
  });

  test("keeps `$'` literal inside double quotes", () => {
    expect(words(scan("echo \"$'a\\'\" b"))).toEqual([
      [
        ["echo", "echo"],
        ["\"$'a\\'\"", "$'a\\'"],
        ["b", "b"],
      ],
    ]);
  });

  test("treats an escaped dollar as ordinary text before a plain quote", () => {
    expect(words(scan("echo \\$'a\\' b"))).toEqual([
      [
        ["echo", "echo"],
        ["\\$'a\\'", "$a\\"],
        ["b", "b"],
      ],
    ]);
  });

  test("splits `$$'…'` the way a plain quote does", () => {
    expect(words(scan("echo $$'a\\' b"))).toEqual([
      [
        ["echo", "echo"],
        ["$$'a\\'", "$$a\\"],
        ["b", "b"],
      ],
    ]);
  });

  test("reads `$$$'…'` as one word", () => {
    expect(words(scan("echo $$$'a\\'b'"))).toEqual([
      [
        ["echo", "echo"],
        ["$$$'a\\'b'", "$$$a\\'b"],
      ],
    ]);
  });

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
      { raw: "$''$'a\\'b'", value: "$$a\\'b" },
    ],
    [
      'ends an ANSI-C string after an empty `$""` quote',
      "echo $\"\"$'a\\'b'; echo RAN",
      1,
      { value: "$$a\\'b" },
    ],
    [
      "ends an ANSI-C string after an empty plain quote",
      "echo ''$'a\\'b'; echo RAN",
      1,
      { raw: "''$'a\\'b'", value: "$a\\'b" },
    ],
    [
      "reads an odd run of `$` before a quote as ANSI-C",
      "echo $$$'x\\'y'; echo RAN",
      1,
      { value: "$$$x\\'y" },
    ],
    [
      "reads an odd run of five `$` before a quote as ANSI-C",
      "echo $$$$$'x\\'y'; echo RAN",
      1,
      { value: "$$$$$x\\'y" },
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
      { value: "\u0024{x}$a\\'b" },
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
    expect(last).toMatchObject({ value: "$a\\'b" });
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
