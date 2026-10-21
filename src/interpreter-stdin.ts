// Whether a non-shell interpreter runs what its stdin carries: no script operand, or an explicit `-`.

import {
  OPTIONS_WITH_VALUE,
  stopsBeforeTarget,
} from "./interpreter-options.ts";
import { INTERPRETER_SPECS } from "./interpreter-specs.ts";
import { shellBasename } from "./shell-lexer.ts";
import type { ShellToken } from "./shell-token.ts";

/**
 * Whether the interpreter that `words` start with takes its code from stdin:
 * a lone `-` says so, and so does the absence of any operand, with options
 * and the values of the options known to take one skipped. The first
 * operand, or an option that supplies the code itself (`-c`, `-e`, `-m`) or
 * ends the search, means stdin is data. A first non-option word counts as an
 * operand, so an option whose grammar is not known leaves stdin as data.
 */
export function interpreterReadsStdin(words: readonly ShellToken[]): boolean {
  const name = shellBasename(words[0]?.value ?? "");
  const spec = INTERPRETER_SPECS[name];
  const valued = (option: string): boolean =>
    OPTIONS_WITH_VALUE.has(option) || spec?.valueOptions?.has(option) === true;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]?.value ?? "";
    if (word === "-") return true;
    if (word === "--") return index + 1 >= words.length;
    if (!word.startsWith("-") || stopsBeforeTarget(word, name, spec))
      return false;
    if (valued(word)) index += 1;
  }
  return true;
}
