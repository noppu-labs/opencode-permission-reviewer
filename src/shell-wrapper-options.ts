// Command-head and wrapper-option skipping for the effective-command walk: keywords, VAR=value assignments, value-taking options and getopt clusters.

import { elementAt } from "./element-at.ts";
import { SHELL_KEYWORDS, VALUE_OPTIONS } from "./shell-lexer-tables.ts";
import type { ShellToken } from "./shell-token.ts";

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NO_VALUE_OPTIONS: ReadonlySet<string> = new Set();

/** Skip leading keywords, then leading VAR=value assignments (env-style,
 *  only at the head). */
export function commandStart(words: ShellToken[]): number {
  let i = 0;
  while (
    i < words.length &&
    SHELL_KEYWORDS.has(elementAt(words, i, "tokens").value)
  )
    i += 1;
  while (
    i < words.length &&
    ASSIGNMENT.test(elementAt(words, i, "tokens").value)
  )
    i += 1;
  return i;
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

/** chroot [OPTION]... NEWROOT [COMMAND [ARG]...]: skip options, then the
 *  NEWROOT token, and return the index of the real command tail. */
export function chrootCommandIndex(words: ShellToken[], i: number): number {
  return skipOptions(words, i + 1, NO_VALUE_OPTIONS) + 1;
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

/** Skip the options of the transparent `wrapper` at `index` and the
 *  env-style VAR=value arguments that may follow it (e.g. `env FOO=bar …`),
 *  and return the index of the wrapped command. */
export function skipWrapperArguments(
  words: ShellToken[],
  index: number,
  wrapper: string,
): number {
  const valueOpts = valueOptionsOf(wrapper);
  let i = index + 1;
  while (i < words.length) {
    const opt = elementAt(words, i, "tokens").value;
    if (opt === "--") return i + 1;
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
