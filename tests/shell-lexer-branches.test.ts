import { describe, expect, test } from "bun:test";
import {
  type LexBudget,
  MAX_SUBSTITUTION_CHARS,
} from "../src/shell-lex-state.ts";
import { lexSegmentsBounded } from "../src/shell-lexer.ts";
import {
  normalizeShellRedirections,
  type ShellRedirection,
} from "../src/shell-redirections.ts";
import { lexSegments } from "../src/shell-scanner.ts";
import type { ShellToken } from "../src/shell-token.ts";

const budget = (tokensRemaining: number): LexBudget => ({
  tokensRemaining,
  substitutions: "lex",
  substitutionCharsRemaining: MAX_SUBSTITUTION_CHARS,
});

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
    const state = budget(3);
    expect(lexSegments("a b; c d", state)).toEqual([
      { tokens: [plain("a"), plain("b")], endedBy: ";" },
    ]);
    expect(state.tokensRemaining).toBe(0);

    const flat = budget(1);
    expect(lexSegments("a b", flat)).toEqual([]);
    expect(flat.tokensRemaining).toBe(0);
  });

  test("a separator that spends the budget still emits its segment", () => {
    const state = budget(1);
    expect(lexSegments("a; b", state)).toEqual([
      { tokens: [plain("a")], endedBy: ";" },
    ]);
    expect(state.tokensRemaining).toBe(0);
  });

  test("the budget is only checked after a flush, so a final flush can overdraw it", () => {
    const state = budget(0);
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

  test("a literal backslash inside double quotes repeats the next character in raw", () => {
    expect(lexSegments('python "a\\nb.py"')[0]?.tokens[1]).toEqual({
      raw: '"a\\nnb.py"',
      value: "a\\nb.py",
      spans: [{ text: "a\\nb.py", quoted: true }],
    });
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

  test("|& and ;& are single separators", () => {
    expect(lexSegments("a |& b")).toEqual([
      { tokens: [plain("a")], endedBy: "|&" },
      { tokens: [plain("b")], precededBy: "|&" },
    ]);
    expect(lexSegments("a ;& b")).toEqual([
      { tokens: [plain("a")], endedBy: ";&" },
      { tokens: [plain("b")], precededBy: ";&" },
    ]);
    // `;;&` is the ordinary `;` separator followed by the `;&` one; the
    // empty segment the second separator flushes is dropped as today.
    expect(
      lexSegments("a ;;& b").map((s) => [s.endedBy, s.precededBy]),
    ).toEqual([
      [";", undefined],
      [undefined, ";&"],
    ]);
    // The doubled forms are unchanged.
    expect(lexSegments("a || b").map((s) => s.endedBy)).toEqual([
      "||",
      undefined,
    ]);
    expect(lexSegments("a && b").map((s) => s.endedBy)).toEqual([
      "&&",
      undefined,
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

  test("an input-duplication redirection stays in its token", () => {
    expect(redirectionsOf("cmd <&3")).toEqual([
      {
        words: ["cmd"],
        redirections: [{ operator: "<&", target: "3", quoted: false }],
      },
    ]);
    expect(redirectionsOf("exec 3<&0")).toEqual([
      {
        words: ["exec"],
        redirections: [{ operator: "3<&", target: "0", quoted: false }],
      },
    ]);
    expect(redirectionsOf("cmd 0<&- && ok")).toEqual([
      {
        words: ["cmd"],
        redirections: [{ operator: "0<&", target: "-", quoted: false }],
      },
      { words: ["ok"], redirections: [] },
    ]);
    // The normalizer half of the old test still holds for a span-less token.
    expect(
      normalizeShellRedirections([plain("cmd"), { raw: "<&3", value: "<&3" }]),
    ).toEqual({
      tokens: [plain("cmd")],
      redirections: [{ operator: "<&", target: "3", quoted: false }],
    });
  });

  test("output-only glue rules are unchanged", () => {
    // `|` continues only an output redirection (`>|`), never an input one.
    expect(tokenValues("a<|b")).toEqual([["a<"], ["b"]]);
    // A background separator after a plain word is still a separator.
    expect(lexSegments("a < b & c")).toEqual([
      { tokens: [plain("a"), plain("<"), plain("b")], endedBy: "&" },
      { tokens: [plain("c")], precededBy: "&" },
    ]);
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

  test("operator lookahead skips quoted characters, so a quoted > can join an operator", () => {
    expect(redirectionsOf('echo >">">f')).toEqual([
      {
        words: ["echo"],
        redirections: [{ operator: ">", target: "f", quoted: false }],
      },
    ]);
    expect(redirectionsOf("echo >'>'f")).toEqual([
      {
        words: ["echo"],
        redirections: [{ operator: ">", target: ">f", quoted: true }],
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
