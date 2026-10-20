// Which commands read a script from their stdin: a shell given no script file and no command string, and the plain `cat` that passes a heredoc on.

import { shellBasename } from "./shell-lexer.ts";
import {
  SHELL_LONG_VALUE_OPTIONS,
  SHELL_NO_RUN_LONG_OPTIONS,
  STDIN_SCRIPT_SHELLS,
} from "./shell-lexer-tables.ts";
import type { ShellToken } from "./shell-token.ts";

/** What a shell's words before its first operand say. */
interface OptionScan {
  /** `-s`: the script comes from stdin, and the operands that follow are its
   *  arguments. */
  stdinFlag: boolean;
  /** `-c`: the first operand is a command string. */
  command: boolean;
  /** `-n`, `--version`, `--help`: nothing runs. */
  noRun: boolean;
  /** A word names a script file. */
  operand: boolean;
}

/** The words `cat` may have and still pass its stdin on as it is. */
const CAT_PLAIN_WORDS = new Set(["-u", "-", "--"]);

/** Whether the shell at `from` in `words` reads its script from stdin: with `-s`,
 *  or with neither `-c` nor an operand before the first non-option word.
 *  Where shells disagree on a form, it counts. */
export function shellReadsStdin(
  words: readonly ShellToken[],
  from = 0,
): boolean {
  const head = words[from]?.value ?? "";
  if (!STDIN_SCRIPT_SHELLS.has(shellBasename(head))) return false;
  const scan = scanOptions(words, from + 1);
  if (scan.noRun) return false;
  return scan.stdinFlag || (!scan.command && !scan.operand);
}

/** Whether `words` are a `cat` that passes its stdin on unchanged: no
 *  options, or `-u`, with no file operand but `-`. */
export function catPassesStdin(words: readonly ShellToken[]): boolean {
  if (shellBasename(words[0]?.value ?? "") !== "cat") return false;
  return words.slice(1).every((word) => CAT_PLAIN_WORDS.has(word.value));
}

function scanOptions(words: readonly ShellToken[], from: number): OptionScan {
  const scan: OptionScan = {
    stdinFlag: false,
    command: false,
    noRun: false,
    operand: false,
  };
  let skip = 0;
  for (let index = from; index < words.length; index += 1) {
    if (skip > 0) {
      skip -= 1;
      continue;
    }
    const word = words[index]?.value ?? "";
    const taken = scanWord(word, index + 1 < words.length, scan);
    if (taken === undefined) break;
    skip = taken;
  }
  return scan;
}

/** Notes one word. Returns the words it takes after itself, or `undefined`
 *  when it ends the options: `-` and `--` make a following word an operand,
 *  and any other plain word is one. */
function scanWord(
  word: string,
  more: boolean,
  scan: OptionScan,
): number | undefined {
  if (word === "-" || word === "--") {
    scan.operand = more;
    return undefined;
  }
  if (word.startsWith("--")) return longOption(word, scan);
  if (word.length > 1 && (word.startsWith("-") || word.startsWith("+")))
    return optionCluster(word, scan);
  scan.operand = true;
  return undefined;
}

/** The words a long option takes after itself. */
function longOption(word: string, scan: OptionScan): number {
  if (SHELL_NO_RUN_LONG_OPTIONS.has(word)) scan.noRun = true;
  return SHELL_LONG_VALUE_OPTIONS.has(word) ? 1 : 0;
}

/** Notes the letters of a `-abc` or `+abc` cluster and returns the words its
 *  value letters (`o`, `O`) take after it. A `+` cluster only unsets. */
function optionCluster(word: string, scan: OptionScan): number {
  const sets = word.startsWith("-");
  let values = 0;
  for (const letter of word.slice(1)) {
    if (letter === "o" || letter === "O") values += 1;
    else if (!sets) continue;
    else if (letter === "s") scan.stdinFlag = true;
    else if (letter === "c") scan.command = true;
    else if (letter === "n") scan.noRun = true;
  }
  return values;
}
