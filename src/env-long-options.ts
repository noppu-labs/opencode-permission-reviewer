// env's long options spelled out as getopt_long reads them: an unambiguous prefix stands for the whole name.

import { elementAt } from "./element-at.ts";
import { ENV_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The abbreviated long options of the `env` at `i`, each with its index
 *  and the token written in full, so `--arg x` reads as `--argv0 x` and
 *  `--split=s` as `--split-string=s`. Option values, ambiguous prefixes and
 *  the words after env's options are kept. `valueOptions` are the short
 *  options that take a value. */
export function envLongOptionSpellings(
  words: readonly ShellToken[],
  i: number,
  valueOptions: ReadonlySet<string>,
): [number, ShellToken][] {
  const spellings: [number, ShellToken][] = [];
  let j: number | undefined = i + 1;
  while (j !== undefined && j < words.length) {
    const token = elementAt(words, j, "tokens");
    const full = fullSpelling(token.value);
    if (full !== undefined && full !== token.value)
      spellings.push([j, { ...token, value: full }]);
    j = nextOption(token.value, j, valueOptions);
  }
  return spellings;
}

/** The index of the word after the option at `j` and its value, or
 *  `undefined` once env's options end there. */
function nextOption(
  value: string,
  j: number,
  valueOptions: ReadonlySet<string>,
): number | undefined {
  if (ASSIGNMENT.test(value)) return j + 1;
  if (value === "--" || value === "-" || !value.startsWith("-")) return;
  if (value.startsWith("--")) {
    const long = resolveGnuLongOption(value, ENV_LONG_OPTIONS);
    return long?.argument === "required" && !long.inlineValue ? j + 2 : j + 1;
  }
  const letters = value.slice(1);
  const position = letters
    .split("")
    .findIndex((letter) => valueOptions.has(`-${letter}`));
  return position === letters.length - 1 ? j + 2 : j + 1;
}

/** The long option `value` names, written in full; `undefined` when it is
 *  none env takes. */
function fullSpelling(value: string): string | undefined {
  const long = resolveGnuLongOption(value, ENV_LONG_OPTIONS);
  if (long === undefined) return;
  if (!long.inlineValue) return `--${long.name}`;
  return `--${long.name}${value.slice(value.indexOf("="))}`;
}
