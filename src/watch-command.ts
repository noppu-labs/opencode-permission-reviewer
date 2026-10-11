// procps-ng watch: where its options end and whether it execs its operands (-x) or joins them into a command string for sh -c.

import { elementAt } from "./element-at.ts";
import { WATCH_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";
import { skipAssignments } from "./shell-wrapper-options.ts";

/** The letters of watch's optstring `+bCcefd::ghq:n:prs:twvx` that take a
 *  value: a required one in the rest of the cluster or the next token, and
 *  an optional one only in the rest of the cluster. */
const REQUIRED_VALUE_LETTERS = new Set(["n", "q", "s"]);
const OPTIONAL_VALUE_LETTERS = new Set(["d"]);

/** How the operands from `operandIndex` run: execed as argv with `exec`,
 *  otherwise joined with single spaces into the string watch passes to
 *  sh -c. */
interface WatchCommand {
  readonly operandIndex: number;
  readonly exec: boolean;
}

/** What one option token means: how many tokens it spans and whether it
 *  selects -x/--exec. */
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
  if (exec) return skipAssignments(words, operandIndex);
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

/** The command string watch runs through sh -c: its operands from `start`
 *  joined with single spaces. */
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

/** A short cluster: flags up to the first value-taking letter, which takes
 *  the rest of the cluster as its value, or the next token when it ends the
 *  cluster and its value is required. */
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
