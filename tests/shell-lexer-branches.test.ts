import { describe, expect, test } from "bun:test";
import {
  lexSegments,
  lexSegmentsBounded,
  normalizeShellRedirections,
  type ShellRedirection,
  type ShellToken,
} from "../src/shell-lexer.ts";

function plain(text: string): ShellToken {
  return { raw: text, value: text, spans: [{ text, quoted: false }] };
}

function tokenValues(command: string): string[][] {
  return lexSegments(command).map((segment) =>
    segment.tokens.map((token) => token.value),
  );
}

function redirectionsOf(command: string): {
  words: string[];
  redirections: ShellRedirection[];
}[] {
  return lexSegments(command).map((segment) => {
    const normalized = normalizeShellRedirections(segment.tokens);
    return {
      words: normalized.tokens.map((token) => token.value),
      redirections: normalized.redirections,
    };
  });
}

describe("shell lexer token budget", () => {
  test("the token that spends the budget is consumed but its open segment is dropped", () => {
    const state = { tokensRemaining: 3 };
    expect(lexSegments("a b; c d", state)).toEqual([
      { tokens: [plain("a"), plain("b")], endedBy: ";" },
    ]);
    expect(state.tokensRemaining).toBe(0);

    const flat = { tokensRemaining: 1 };
    expect(lexSegments("a b", flat)).toEqual([]);
    expect(flat.tokensRemaining).toBe(0);
  });

  test("a separator that spends the budget still emits its segment", () => {
    const state = { tokensRemaining: 1 };
    expect(lexSegments("a; b", state)).toEqual([
      { tokens: [plain("a")], endedBy: ";" },
    ]);
    expect(state.tokensRemaining).toBe(0);
  });

  test("the budget is only checked after a flush, so a final flush can overdraw it", () => {
    const state = { tokensRemaining: 0 };
    expect(lexSegments("a", state)).toEqual([{ tokens: [plain("a")] }]);
    expect(state.tokensRemaining).toBe(-1);
  });

  test("bounded lexing truncates at the token cap and the input cap", () => {
    const atCap = lexSegmentsBounded("a ".repeat(16_384));
    expect(atCap).toEqual({ segments: [], truncated: true });
    const underCap = lexSegmentsBounded("a ".repeat(16_383));
    expect(underCap.truncated).toBe(false);
    expect(underCap.segments.map((s) => s.tokens.length)).toEqual([16_383]);

    expect(lexSegmentsBounded("a".repeat(131_073))).toEqual({
      segments: [],
      truncated: true,
    });
    expect(lexSegmentsBounded("a".repeat(131_072)).truncated).toBe(false);
  });
});

describe("shell lexer quoting edges", () => {
  test("backslash-newline and backslash-CR inside double quotes vanish", () => {
    expect(lexSegments('echo "a\\\nb"')[0]?.tokens[1]).toEqual({
      raw: '"a\\\nb"',
      value: "ab",
      spans: [{ text: "ab", quoted: true }],
    });
    expect(lexSegments('echo "a\\\rb"')[0]?.tokens[1]).toEqual({
      raw: '"a\\\rb"',
      value: "ab",
      spans: [{ text: "ab", quoted: true }],
    });
  });

  test("double quotes unescape dollar, backtick and backslash", () => {
    expect(tokenValues('echo "\\$x \\`y\\` \\\\z"')).toEqual([
      ["echo", "$x `y` \\z"],
    ]);
  });

  test("a trailing backslash stays literal inside and outside double quotes", () => {
    expect(lexSegments('echo "abc\\')[0]?.tokens[1]).toEqual({
      raw: '"abc\\',
      value: "abc\\",
      spans: [{ text: "abc\\", quoted: true }],
    });
    expect(lexSegments("echo a\\")[0]?.tokens[1]).toEqual({
      raw: "a\\",
      value: "a\\",
      spans: [{ text: "a\\", quoted: false }],
    });
  });

  test("backslash-CR outside quotes is a line continuation", () => {
    expect(lexSegments("r\\\rm")).toEqual([
      {
        tokens: [
          {
            raw: "r\\\rm",
            value: "rm",
            spans: [{ text: "rm", quoted: false }],
          },
        ],
      },
    ]);
  });

  test("an unterminated single quote still yields its token", () => {
    expect(lexSegments("echo 'abc")[0]?.tokens[1]).toEqual({
      raw: "'abc",
      value: "abc",
      spans: [{ text: "abc", quoted: true }],
    });
  });

  test("an empty quoted word is a token with no spans", () => {
    expect(lexSegments("echo '' x")[0]?.tokens).toEqual([
      plain("echo"),
      { raw: "''", value: "", spans: [] },
      plain("x"),
    ]);
  });

  test("a carriage return separates like a newline and a tab splits words", () => {
    expect(lexSegments("a\rb")).toEqual([
      { tokens: [plain("a")], endedBy: ";" },
      { tokens: [plain("b")], precededBy: ";" },
    ]);
    expect(tokenValues("a\tb")).toEqual([["a", "b"]]);
  });

  test("& and | after a quoted > are separators, not redirection glue", () => {
    expect(lexSegments("echo '>'&b")).toEqual([
      {
        tokens: [
          plain("echo"),
          { raw: "'>'", value: ">", spans: [{ text: ">", quoted: true }] },
        ],
        endedBy: "&",
      },
      { tokens: [plain("b")], precededBy: "&" },
    ]);
    expect(lexSegments('echo ">"|cat')).toEqual([
      {
        tokens: [
          plain("echo"),
          { raw: '">"', value: ">", spans: [{ text: ">", quoted: true }] },
        ],
        endedBy: "|",
      },
      { tokens: [plain("cat")], precededBy: "|" },
    ]);
  });
});

describe("shell redirection normalizer edges", () => {
  test("recognizes the three-character and <> operators", () => {
    expect(redirectionsOf("cat <<<word")).toEqual([
      {
        words: ["cat"],
        redirections: [{ operator: "<<<", target: "word", quoted: false }],
      },
    ]);
    expect(redirectionsOf("cat <<-EOF")).toEqual([
      {
        words: ["cat"],
        redirections: [{ operator: "<<-", target: "EOF", quoted: false }],
      },
    ]);
    expect(redirectionsOf("cmd &>>log")).toEqual([
      {
        words: ["cmd"],
        redirections: [{ operator: "&>>", target: "log", quoted: false }],
      },
    ]);
    expect(redirectionsOf("cmd <>file")).toEqual([
      {
        words: ["cmd"],
        redirections: [{ operator: "<>", target: "file", quoted: false }],
      },
    ]);
  });

  test("the lexer splits <& at the ampersand, so only span-less tokens reach the <& operator", () => {
    expect(redirectionsOf("cmd <&3")).toEqual([
      { words: ["cmd"], redirections: [] },
      { words: ["3"], redirections: [] },
    ]);
    expect(
      normalizeShellRedirections([plain("cmd"), { raw: "<&3", value: "<&3" }]),
    ).toEqual({
      tokens: [plain("cmd")],
      redirections: [{ operator: "<&", target: "3", quoted: false }],
    });
  });

  test("one word can carry several redirections", () => {
    expect(redirectionsOf("cmd >a>b")).toEqual([
      {
        words: ["cmd"],
        redirections: [
          { operator: ">", target: "a", quoted: false },
          { operator: ">", target: "b", quoted: false },
        ],
      },
    ]);
  });

  test("an operator without a usable target is dropped", () => {
    expect(redirectionsOf("echo >")).toEqual([
      { words: ["echo"], redirections: [] },
    ]);
    expect(redirectionsOf("echo > >f")).toEqual([
      {
        words: ["echo"],
        redirections: [{ operator: ">", target: "f", quoted: false }],
      },
    ]);
    expect(redirectionsOf("echo >&>f")).toEqual([
      {
        words: ["echo"],
        redirections: [{ operator: ">", target: "f", quoted: false }],
      },
    ]);
  });

  test("an empty quoted target is reported as unquoted", () => {
    expect(redirectionsOf("echo > ''")).toEqual([
      {
        words: ["echo"],
        redirections: [{ operator: ">", target: "", quoted: false }],
      },
    ]);
  });

  test("a partly quoted target is quoted and a non-digit prefix stays a word", () => {
    expect(redirectionsOf("echo >'q'x")).toEqual([
      {
        words: ["echo"],
        redirections: [{ operator: ">", target: "qx", quoted: true }],
      },
    ]);
    expect(redirectionsOf("a2>f")).toEqual([
      {
        words: ["a2"],
        redirections: [{ operator: ">", target: "f", quoted: false }],
      },
    ]);
    expect(redirectionsOf("echo 10>>log")).toEqual([
      {
        words: ["echo"],
        redirections: [{ operator: "10>>", target: "log", quoted: false }],
      },
    ]);
  });
});
