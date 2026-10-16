import { describe, expect, test } from "bun:test";
import { actionSegments } from "../src/ui-action-segments.ts";
import type { ActionSegment } from "../src/ui-protocol.ts";

/** A seeded generator, so every run checks the same commands. */
function random(seed: number): () => number {
  let state = seed;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const WORDS = [
  "ls",
  "-la",
  "a",
  "b1",
  "x=1",
  "'q  r'",
  '"d $v"',
  "$(pwd)",
  "$(a | b)",
  "`id`",
  "\u0024{v}",
  "$[1]",
  "$((1+2))",
  "2>&1",
  ">f",
  "<in",
  "a#b",
  "(",
  ")",
  "{",
  "}",
  "<",
  ">",
  "&",
  "|",
  ";",
  "!",
];
const GLUE = [
  " ",
  " ",
  "  ",
  "\t",
  " | ",
  "|",
  " || ",
  " && ",
  "&&",
  "; ",
  ";",
  "\n",
  "\n\n",
  " & ",
  "&",
  " \\\n ",
  " # note\n",
  "\r",
];

/** Glue that keeps the command on one line. */
const SAME_LINE = GLUE.filter((glue) => !glue.includes("\n"));
/** Heredoc operators and the delimiter line each one ends at. */
const HEREDOCS: ReadonlyArray<[string, string]> = [
  ["<<EOF", "EOF"],
  ["<< EOF", "EOF"],
  ["<<'EOF'", "EOF"],
  ['<<"EOF"', "EOF"],
  ["<<\\EOF", "EOF"],
  ["<<-EOF", "\tEOF"],
  ["2<<END", "END"],
];

const pick = (next: () => number, list: readonly string[]): string =>
  list[Math.floor(next() * list.length)] ?? "";

function command(
  next: () => number,
  glue: readonly string[] = GLUE,
  most = 8,
): string {
  let text = pick(next, WORDS);
  const count = Math.floor(next() * (most + 1));
  for (let index = 0; index < count; index += 1)
    text += pick(next, glue) + pick(next, WORDS);
  return text;
}

/** A command with one heredoc, its body's line count, and the command
 *  without the body and delimiter lines. */
function heredocCommand(next: () => number): {
  source: string;
  lines: number;
  outside: string;
} {
  const [operator, delimiter] = HEREDOCS[
    Math.floor(next() * HEREDOCS.length)
  ] ?? ["<<EOF", "EOF"];
  const before = `${command(next, SAME_LINE, 3)} ${operator}`;
  const after =
    next() < 0.5
      ? ""
      : `${pick(next, SAME_LINE)}${command(next, SAME_LINE, 2)}`;
  const lines = Math.floor(next() * 4);
  const body = Array.from(
    { length: lines },
    () => `${command(next, SAME_LINE, 3)}\n`,
  );
  const rest = next() < 0.5 ? "" : `\n${command(next)}`;
  return {
    source: `${before}${after}\n${body.join("")}${delimiter}${rest}`,
    lines,
    outside: `${before}${after}${rest}`,
  };
}

/** The segments as the TUI joins them, before any fitting. */
function shownText(segments: readonly ActionSegment[]): string {
  return segments
    .map((segment) => {
      const separator = segment.separator;
      if (separator === undefined) return segment.text;
      return separator === ";"
        ? `${segment.text};`
        : `${segment.text} ${separator}`;
    })
    .join(" ");
}

const OPERATOR = /[<>|&;]/;

/** Text compared with the spacing the shell ignores taken out: runs of blanks
 *  become one space, and a space with an operator character on exactly one
 *  side goes. A trailing `;` ends nothing, so it goes too. */
function key(text: string): string {
  const compact = text
    .replace(/[ \t]+/g, " ")
    .replace(/[; ]+$/, "")
    .trim();
  let out = "";
  for (const [index, c] of Array.from(compact).entries()) {
    const around = [compact[index - 1], compact[index + 1]].map((side) =>
      OPERATOR.test(side ?? ""),
    );
    if (c !== " " || around[0] === around[1]) out += c;
  }
  return out;
}

/** The command as the display should show it: comments and line
 *  continuations gone, and each line break a `;` unless the line ends in an
 *  operator that needs more. */
function expected(source: string): string {
  const lines = source
    .replace(/ \\\n/g, " ")
    .replace(/(^|[ \t\n])#[^\n]*/g, "$1")
    .split("\n");
  let text = "";
  for (const line of lines) {
    const trimmed = text.trimEnd();
    const continues = trimmed === "" || /[|&;(]$/.test(trimmed);
    text = `${trimmed}${continues ? " " : "; "}${line}`;
  }
  return text;
}

describe("action segments", () => {
  test("always reconstruct the command they are shown for", () => {
    const next = random(40);
    let shown = 0;
    for (let run = 0; run < 20_000; run += 1) {
      const source = command(next);
      const segments = actionSegments(source);
      if (segments === undefined) continue;
      shown += 1;
      expect({
        source: JSON.stringify(source),
        shown: key(shownText(segments)),
      }).toEqual({
        source: JSON.stringify(source),
        shown: key(expected(source)),
      });
    }
    expect(shown).toBeGreaterThan(2_000);
  });

  test("show a heredoc as typed with its body's line count", () => {
    const next = random(41);
    let shown = 0;
    for (let run = 0; run < 10_000; run += 1) {
      const { source, lines, outside } = heredocCommand(next);
      const segments = actionSegments(source);
      if (segments === undefined) continue;
      shown += 1;
      const counted = segments.reduce(
        (sum, segment) => sum + (segment.heredocLines ?? 0),
        0,
      );
      expect({
        source: JSON.stringify(source),
        lines: counted,
        shown: key(shownText(segments)),
      }).toEqual({
        source: JSON.stringify(source),
        lines,
        shown: key(expected(outside)),
      });
    }
    expect(shown).toBeGreaterThan(1_000);
  });
});
