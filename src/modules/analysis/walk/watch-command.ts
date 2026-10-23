// procps-ng watch: where its options end and whether it execs its operands
// (-x) or joins them into a command string for sh -c.

import { elementAt } from "../../../utils/element-at.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import { WATCH_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";

/** The letters of watch's optstring `+bCcefd::ghq:n:prs:twvx` that take a
 *  value: a required one in the rest of the cluster or the next token, and
 *  an optional one only in the rest of the cluster. */
const REQUIRED_VALUE_LETTERS = new Set(["n", "q", "s"]);
const OPTIONAL_VALUE_LETTERS = new Set(["d"]);

interface WatchCommand {
  readonly operandIndex: number;
  readonly exec: boolean;
}

/** `width` counts tokens, a separate value included. */
interface WatchOptionStep {
  readonly width: number;
  readonly exec: boolean;
}

/** watch execs its operands as argv with -x: return where that command
 *  starts, to peel like a transparent wrapper's. Otherwise sh -c runs them
 *  joined as a command string, handed to `reanalyze`. */
export function peelWatch(
  words: ShellToken[],
  i: number,
  reanalyze: (text: string) => void,
): number | undefined {
  const { operandIndex, exec } = watchCommand(words, i);
  if (exec) return operandIndex;
  if (operandIndex < words.length)
    reanalyze(watchCommandString(words, operandIndex));
  return undefined;
}

/** Scan the options of `watch` at `i` the way getopt_long does with a `+`
 *  optstring: the first operand or a `--` ends them. An option watch rejects
 *  (unknown, ambiguous, or `=value` on a flag) makes watch exit without
 *  running anything; it spans one token so the rest is still analysed. */
function watchCommand(words: ShellToken[], i: number): WatchCommand {
  let j = i + 1;
  let exec = false;
  while (j < words.length) {
    const opt = elementAt(words, j, "tokens").value;
    if (opt === "--") return { operandIndex: j + 1, exec };
    if (!opt.startsWith("-") || opt.length <= 1) break;
    const step = opt.startsWith("--") ? longStep(opt) : shortStep(opt);
    exec ||= step.exec;
    j += step.width;
  }
  return { operandIndex: j, exec };
}

function watchCommandString(words: ShellToken[], start: number): string {
  return words
    .slice(start)
    .map((word) => word.value)
    .join(" ");
}

function longStep(opt: string): WatchOptionStep {
  const resolved = resolveGnuLongOption(opt, WATCH_LONG_OPTIONS);
  if (resolved === undefined) return { width: 1, exec: false };
  const separateValue =
    resolved.argument === "required" && !resolved.inlineValue;
  return { width: separateValue ? 2 : 1, exec: resolved.name === "exec" };
}

function shortStep(opt: string): WatchOptionStep {
  let exec = false;
  for (let position = 1; position < opt.length; position += 1) {
    const letter = opt.charAt(position);
    if (letter === "x") exec = true;
    if (OPTIONAL_VALUE_LETTERS.has(letter)) return { width: 1, exec };
    if (REQUIRED_VALUE_LETTERS.has(letter))
      return { width: position === opt.length - 1 ? 2 : 1, exec };
  }
  return { width: 1, exec };
}
