import { shellBasename } from "./shell-lexer.ts";
import type { ShellToken } from "./shell-token.ts";

interface SplitArguments {
  options: ShellToken[];
  operands: ShellToken[];
}

/** A word that reads as an option: a leading `-` with more after it. A lone
 *  `-` is an operand. */
function isOptionWord(value: string): boolean {
  return value.startsWith("-") && value.length > 1;
}

/** The words after a command's name, split at the first `--` (end of
 *  options): option words before it are options, every other word is an
 *  operand, and that `--` itself is neither. */
export function splitArguments(command: readonly ShellToken[]): SplitArguments {
  const split: SplitArguments = { options: [], operands: [] };
  let endOfOptions = false;
  for (const token of command.slice(1)) {
    if (!endOfOptions && token.value === "--") endOfOptions = true;
    else if (!endOfOptions && isOptionWord(token.value))
      split.options.push(token);
    else split.operands.push(token);
  }
  return split;
}

/** The basename of a command's executable word, or `undefined` for an empty
 *  command. */
export function commandName(
  command: readonly ShellToken[],
): string | undefined {
  const first = command[0];
  return first === undefined ? undefined : shellBasename(first.value);
}
