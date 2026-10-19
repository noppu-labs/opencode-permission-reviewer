// Where a command substitution's body ends: the `)` or backtick the shell pairs with its opener.

import type { HeredocReading, SubstitutionScan } from "./shell-lex-state.ts";
import { stepBrace, stepDouble } from "./shell-substitution-brace.ts";
import {
  advance,
  type BodyScan,
  close,
  stepCommand,
} from "./shell-substitution-frames.ts";
import {
  openGroup,
  stepArith,
  stepArray,
  stepTest,
} from "./shell-substitution-groups.ts";
import { startsSubject } from "./shell-substitution-words.ts";

/**
 * Index of the character that closes the substitution whose body starts at
 * `start`: the matching `)` for a `$(` body, the next unescaped backtick for
 * a backtick body, the matching `}` for a `${` body. Returns `text.length`
 * when nothing closes it. Inside a `$(` body, quoted text, comments, heredoc
 * bodies, nested parentheses and `case` patterns do not close it. When
 * `closes` is given, it receives the index each frame inside closed at.
 */
export function substitutionBodyEnd(
  text: string,
  start: number,
  opener: "command" | "backtick" | "brace",
  reading: HeredocReading = "default",
  mode: SubstitutionScan = "bash",
  closes?: Map<number, number>,
): number {
  const scan: BodyScan = {
    text,
    index: start,
    frames: [opener],
    starts: [start],
    closes,
    heredocs: [],
    commandPosition: true,
    reading,
    mode,
    prefix: undefined,
    headStart: -1,
    words: undefined,
    pattern: undefined,
    saved: [],
    escapedEnd: -1,
    lookahead: text.length,
  };
  while (scan.index < text.length) {
    if (step(scan)) return scan.index;
  }
  return text.length;
}

/** Advance past one character or construct; true once the opener's frame
 *  closes at `scan.index`. */
function step(scan: BodyScan): boolean {
  const c = scan.text.charAt(scan.index);
  if (c === "\\") {
    scan.index += 2;
    scan.escapedEnd = scan.index;
    scan.commandPosition = false;
    return false;
  }
  if (scan.words !== undefined) startsSubject(scan, c);
  return stepFrame(scan, c, scan.frames.at(-1));
}

function stepFrame(
  scan: BodyScan,
  c: string,
  frame: string | undefined,
): boolean {
  if (frame === "backtick") return c === "`" ? close(scan) : advance(scan);
  if (frame === "double") return stepDouble(scan, c);
  if (frame === "brace") return stepBrace(scan, c);
  if (frame === "array") return stepArray(scan, c);
  if (frame === "arith") return stepArith(scan, c);
  if (frame === "test") return stepTest(scan, c);
  const group =
    scan.mode === "bash" && (c === "(" || c === "[")
      ? openGroupAt(scan, c, frame === "case")
      : undefined;
  return group ?? stepCommand(scan, c, frame === "case");
}

/** The group a `(` or `[` opens, unless it starts a `case` pattern. */
function openGroupAt(
  scan: BodyScan,
  c: string,
  insideCase: boolean,
): boolean | undefined {
  return insideCase && scan.pattern ? undefined : openGroup(scan, c);
}
