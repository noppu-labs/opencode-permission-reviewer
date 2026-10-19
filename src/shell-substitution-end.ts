// Where a command substitution's body ends: the `)` or backtick the shell pairs with its opener.

import type { HeredocReading, SubstitutionScan } from "./shell-lex-state.ts";
import {
  advance,
  type BodyScan,
  close,
  stepBrace,
  stepCommand,
  stepDouble,
} from "./shell-substitution-frames.ts";

/**
 * Index of the character that closes the substitution whose body starts at
 * `start`: the matching `)` for a `$(` body, the next unescaped backtick for
 * a backtick body. Returns `text.length` when nothing closes it. Inside a
 * `$(` body, quoted text, comments, heredoc bodies, nested parentheses and
 * `case` patterns do not close it.
 */
export function substitutionBodyEnd(
  text: string,
  start: number,
  opener: "command" | "backtick",
  reading: HeredocReading = "default",
  mode: SubstitutionScan = "bash",
): number {
  const scan: BodyScan = {
    text,
    index: start,
    frames: [opener],
    heredocs: [],
    commandPosition: true,
    reading,
    mode,
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
  const frame = scan.frames.at(-1);
  if (c === "\\") {
    scan.index += 2;
    scan.commandPosition = false;
    return false;
  }
  if (frame === "backtick") return c === "`" ? close(scan) : advance(scan);
  if (frame === "double") return stepDouble(scan, c);
  if (frame === "brace") return stepBrace(scan, c);
  return stepCommand(scan, c, frame === "case");
}
