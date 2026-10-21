// Command-head and wrapper-option skipping for the effective-command walk: keywords, VAR=value assignments, value-taking options and getopt clusters.

import { elementAt } from "./element-at.ts";
import { CHROOT_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import {
  LONE_DASH_OPTION_WRAPPERS,
  SHELL_KEYWORDS,
  VALUE_OPTIONS,
} from "./shell-lexer-tables.ts";
import type { ShellToken } from "./shell-token.ts";

export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
export const NO_VALUE_OPTIONS: ReadonlySet<string> = new Set();

/** Skip leading keywords, then leading VAR=value assignments (env-style,
 *  only at the head), from `start`. */
export function commandStart(words: ShellToken[], start = 0): number {
  let i = start;
  while (
    i < words.length &&
    SHELL_KEYWORDS.has(elementAt(words, i, "tokens").value)
  )
    i += 1;
  return skipAssignments(words, i);
}

function valueOptionsOf(wrapper: string): ReadonlySet<string> {
  return VALUE_OPTIONS[wrapper] ?? NO_VALUE_OPTIONS;
}

/** timeout [OPTION]... DURATION COMMAND [ARG]...: unlike the generic
 *  wrappers, a mandatory non-option DURATION operand sits between the options
 *  and the command, so skip options, then exactly one duration token, and
 *  return the index of the real command tail. With no command left (plain
 *  `timeout 5` just errors) there is nothing to peel to. */
export function timeoutCommandIndex(words: ShellToken[], i: number): number {
  return skipOptions(words, i + 1, valueOptionsOf("timeout")) + 1;
}

/** chroot [OPTION]... NEWROOT [COMMAND [ARG]...]: skip options (long only,
 *  getopt_long rules), then the NEWROOT token, and return the index of the
 *  real command tail. */
export function chrootCommandIndex(words: ShellToken[], i: number): number {
  let j = i + 1;
  while (j < words.length) {
    const opt = elementAt(words, j, "tokens").value;
    if (opt === "--") return j + 2;
    if (!opt.startsWith("-") || opt.length <= 1) return j + 1;
    const long = resolveGnuLongOption(opt, CHROOT_LONG_OPTIONS);
    j += long?.argument === "required" && !long.inlineValue ? 2 : 1;
  }
  return j + 1;
}

/** Skip options up to the first operand, or past a `--`, and return its
 *  index. */
function skipOptions(
  words: ShellToken[],
  start: number,
  valueOpts: ReadonlySet<string>,
): number {
  let j = start;
  while (j < words.length) {
    const opt = elementAt(words, j, "tokens").value;
    if (opt === "--") return j + 1;
    if (!opt.startsWith("-") || opt.length <= 1) return j;
    j = skipWrapperOption(opt, j, valueOpts);
  }
  return j;
}

/** Skip the VAR=value arguments from `start` and return the next index. */
function skipAssignments(words: ShellToken[], start: number): number {
  let i = start;
  while (
    i < words.length &&
    ASSIGNMENT.test(elementAt(words, i, "tokens").value)
  )
    i += 1;
  return i;
}

/** A wrapper that reads a lone `-` as an option ending its options also does
 *  so directly after the `--`. */
function afterDoubleDash(
  words: ShellToken[],
  dashIndex: number,
  wrapper: string,
): number {
  const next = words[dashIndex + 1];
  if (next?.value === "-" && LONE_DASH_OPTION_WRAPPERS.has(wrapper))
    return skipAssignments(words, dashIndex + 2);
  return dashIndex + 1;
}

/** Skip the options of the transparent `wrapper` at `index` and the
 *  env-style VAR=value arguments that may follow it (e.g. `env FOO=bar …`),
 *  and return the index of the wrapped command, with `valueOpts` the options
 *  that take a value. */
export function skipWrapperArguments(
  words: ShellToken[],
  index: number,
  wrapper: string,
  valueOpts: ReadonlySet<string> = valueOptionsOf(wrapper),
): number {
  let i = index + 1;
  while (i < words.length) {
    const opt = elementAt(words, i, "tokens").value;
    if (opt === "--") return afterDoubleDash(words, i, wrapper);
    if (opt === "-" && LONE_DASH_OPTION_WRAPPERS.has(wrapper))
      return skipAssignments(words, i + 1);
    if (ASSIGNMENT.test(opt)) i += 1;
    else if (opt.startsWith("-") && opt.length > 1)
      i = skipWrapperOption(opt, i, valueOpts);
    else return i;
  }
  return i;
}

/** Short-option clusters follow getopt semantics: a value-taking letter takes
 *  the rest of the cluster as its value (`-uroot`, `-un` where `u` takes `n`)
 *  or, when it is last, the next token (`-nu root`).
 *  Misreading a cluster would swallow the wrapped command or mistake the value
 *  for the executable, so `sudo -nu root rm …` must skip the cluster and
 *  `root` together. */
function skipWrapperOption(
  opt: string,
  index: number,
  valueOpts: ReadonlySet<string>,
): number {
  if (valueOpts.has(opt)) return index + 2;
  if (opt.startsWith("--")) return index + 1;
  const letters = opt.slice(1);
  for (let position = 0; position < letters.length; position += 1) {
    if (valueOpts.has(`-${letters.charAt(position)}`)) {
      return position === letters.length - 1 ? index + 2 : index + 1;
    }
  }
  return index + 1;
}
