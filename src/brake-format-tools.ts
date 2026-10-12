import { isOptionWord } from "./brake-arguments.ts";
import {
  type FormatterOptions,
  formatterOptions,
} from "./brake-formatter-options.ts";
import { elementAt } from "./element-at.ts";
import { type LongOption, resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

/** What one option word means for the dry-run scan. */
interface OptionStep {
  readonly dryRun: boolean;
  readonly takesNext: boolean;
}

const NOT_AN_OPTION: OptionStep = { dryRun: false, takesNext: false };

/** Only a formatter's own dry-run flag spares it: other tools read `-n` as a
 *  real option (mkfs.vfat's volume name, mkfs.xfs's naming options). */
export function formatDestroysDevice(
  base: string,
  args: readonly ShellToken[],
): boolean {
  return !runsDry(args, formatterOptions(base, args));
}

/** Scans argv as getopt does, up to `--`: a dry-run option counts only where
 *  getopt reads an option, not as another option's value. Without a known
 *  optstring, any option word may take the next word as its value. */
function runsDry(
  args: readonly ShellToken[],
  options: FormatterOptions | undefined,
): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const word = elementAt(args, index, "args").value;
    if (word === "--") return false;
    if (word === "--dry-run") return true;
    const step = optionStep(word, options);
    if (step.dryRun) return true;
    if (step.takesNext) index += 1;
  }
  return false;
}

function optionStep(
  word: string,
  options: FormatterOptions | undefined,
): OptionStep {
  if (!isOptionWord(word)) return NOT_AN_OPTION;
  if (word.startsWith("--")) return longStep(word, options);
  if (options === undefined) return { dryRun: false, takesNext: true };
  return shortStep(word, options);
}

/** A long option the tool rejects makes it exit without formatting. */
function longStep(
  word: string,
  options: FormatterOptions | undefined,
): OptionStep {
  const long = resolveGnuLongOption(word, options?.longOptions ?? []);
  if (long === undefined)
    return {
      dryRun: false,
      takesNext: options === undefined && !word.includes("="),
    };
  return {
    dryRun: false,
    takesNext: long.argument === "required" && !long.inlineValue,
  };
}

/** A cluster's letters are flags up to the first one that takes a value,
 *  which takes the rest of the cluster or, when it ends the cluster and its
 *  value is required, the next word. */
function shortStep(word: string, options: FormatterOptions): OptionStep {
  for (let position = 1; position < word.length; position += 1) {
    const letter = word.charAt(position);
    if (letter === options.dryRunLetter)
      return { dryRun: true, takesNext: false };
    const argument = letterArgument(options.optstring, letter);
    if (argument !== "none")
      return {
        dryRun: false,
        takesNext: argument === "required" && position === word.length - 1,
      };
  }
  return NOT_AN_OPTION;
}

function letterArgument(
  optstring: string,
  letter: string,
): LongOption["argument"] {
  const at = letter === ":" ? -1 : optstring.indexOf(letter);
  if (at === -1 || optstring.charAt(at + 1) !== ":") return "none";
  return optstring.charAt(at + 2) === ":" ? "optional" : "required";
}
