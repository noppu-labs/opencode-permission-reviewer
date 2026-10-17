import { describe, expect, test } from "bun:test";
import {
  type LexBudget,
  MAX_SUBSTITUTION_CHARS,
  type ShellQuoting,
} from "../src/shell-lex-state.ts";
import { normalizeShellRedirections } from "../src/shell-redirections.ts";
import { lexSegments } from "../src/shell-scanner.ts";

interface Normalized {
  words: string;
  redirections: string[];
}

function normalize(command: string, quoting?: ShellQuoting): Normalized {
  const budget: LexBudget = {
    tokensRemaining: Number.POSITIVE_INFINITY,
    substitutions: "lex",
    substitutionCharsRemaining: MAX_SUBSTITUTION_CHARS,
    ...(quoting === undefined ? {} : { quoting }),
  };
  const tokens = lexSegments(command, budget).flatMap(
    (segment) => segment.tokens,
  );
  const { tokens: words, redirections } = normalizeShellRedirections(tokens);
  return {
    words: words.map((word) => word.value).join(" "),
    redirections: redirections.map((r) => `${r.operator}:${r.target}`),
  };
}

const OPERATORS = [
  "<",
  ">",
  ">>",
  "<<<",
  "<>",
  ">&",
  "<&",
  "&>",
  "&>>",
  ">|",
  "2>",
  "2>>",
  "2<",
  "2>&",
  "2<&",
  "2<>",
];
const EMPTY_WORDS = ["''", '""', "$''", '$""', "$'\\0'"];

describe("a redirection whose word is an empty quote", () => {
  const cases = OPERATORS.flatMap((operator) =>
    EMPTY_WORDS.map((word) => [operator, word] as const),
  );

  test.each(cases)(
    "%s%s leaves the next word as a command word",
    (op, word) => {
      expect(normalize(`echo hi ${op}${word} echo RAN`)).toEqual({
        words: "echo hi echo RAN",
        redirections: [`${op}:`],
      });
    },
  );

  test.each(EMPTY_WORDS)("a leading <<<%s keeps the command name", (word) => {
    expect(normalize(`<<<${word} rm -rf /`)).toEqual({
      words: "rm -rf /",
      redirections: ["<<<:"],
    });
  });

  test("a spaced empty word still takes no more of the command", () => {
    expect(normalize("echo hi <<< '' echo RAN")).toEqual({
      words: "echo hi echo RAN",
      redirections: ["<<<:"],
    });
  });
});

describe("an empty quote after a long word", () => {
  test.each(["''", '""', "$''"])("%s is read in linear time", (quote) => {
    const command = `${"a".repeat(400000)}${quote.repeat(400000 / quote.length)}`;
    const start = performance.now();
    expect(normalize(command).redirections).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
  test.each([
    ["a''", "bash"],
    ['a""', "bash"],
    ["a$''", "bash"],
    ["ab''", "bash"],
    [">''|", "undecoded"],
    [">''|", "previous"],
  ] as const)(
    "many %s words under the %s reading are read in linear time",
    (unit, quoting) => {
      const command = unit.repeat(Math.floor(1_048_576 / unit.length));
      const start = performance.now();
      normalize(command, quoting);
      expect(performance.now() - start).toBeLessThan(1000);
    },
  );
});

// The previous readings keep the earlier tokens, so they read these as before.
const UNDECODED_READING: Record<string, string> = {
  "echo hi <<<'' echo RAN": "echo hi RAN | <<<:echo",
  "echo hi <<<$'' echo RAN": "echo hi echo RAN | <<<:$",
  "<<<$'' rm -rf /": "rm -rf / | <<<:$",
  "echo hi >'' echo RAN": "echo hi RAN | >:echo",
  'echo hi >$"" echo RAN': "echo hi echo RAN | >:$",
};

describe.each(["undecoded", "previous"] as const)(
  "the %s reading of an empty redirection word",
  (quoting) => {
    test.each(Object.entries(UNDECODED_READING))(
      "reads %s",
      (command, shape) => {
        const { words, redirections } = normalize(command, quoting);
        expect(`${words} | ${redirections.join(",")}`).toBe(shape);
      },
    );
  },
);
