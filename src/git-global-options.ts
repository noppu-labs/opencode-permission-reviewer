// Git global options: which options before the subcommand take the next token as their value, and where the subcommand starts.

import { elementAt } from "./element-at.ts";

/** Global options git reads with a separate value (`git.c` `handle_options`).
 *  `--super-prefix` is accepted by older Git releases.
 *  `--exec-path` takes a value only as `--exec-path=…`. */
const SEPARATE_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--attr-source",
  "--super-prefix",
]);

export function takesSeparateValue(option: string): boolean {
  return SEPARATE_VALUE_OPTIONS.has(option);
}

/** Index of the git subcommand among `values`, whose `git` executable sits at
 *  `gitIndex`, or `values.length` when there is none. */
export function gitSubcommandIndex(
  values: readonly string[],
  gitIndex: number,
): number {
  let index = gitIndex + 1;
  while (index < values.length) {
    const value = elementAt(values, index, "values");
    if (takesSeparateValue(value)) index += 2;
    else if (value.startsWith("-") && value.length > 1) index += 1;
    else return index;
  }
  return values.length;
}
