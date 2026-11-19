import { elementAt } from "../../../utils/element-at.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import { longOption } from "./getopt-long-option.ts";
import type { ReadOnlyToolMutation } from "./models/read-only-tool-mutation.ts";

/** How a `TOOL [OPTION]... [INPUT [OUTPUT]]` command spells its options. */
interface OperandToolOptions {
  /** Whether an option word takes the next word as its value. */
  takesNextWord(value: string): boolean;
  /** getopt_long tools accept options after operands; xxd stops at the first. */
  permute: boolean;
}

/** uniq's long options with a required value, with the length of each one's
 *  shortest unambiguous prefix. */
const UNIQ_VALUED_LONG: readonly [string, number][] = [
  ["--skip-fields", 8],
  ["--skip-chars", 8],
  ["--check-chars", 4],
];

export const UNIQ_OPTIONS: OperandToolOptions = {
  takesNextWord(value: string): boolean {
    if (value.startsWith("--"))
      return (
        !value.includes("=") &&
        UNIQ_VALUED_LONG.some(
          ([name, minimum]) => longOption(value, name, minimum) !== undefined,
        )
      );
    // `-f N`, `-s N`, `-w N`: the letter ends the cluster, its value attached
    // or in the next word.
    const at = value.slice(1).search(/[fsw]/);
    return at !== -1 && at + 2 === value.length;
  },
  permute: true,
};

/** xxd's options that take a value, by letter, with the tails of their long
 *  spellings (`-c`, `-cols`). Such a word takes the next word as its value;
 *  any other text after the letter is the value itself (`-c8`). */
const XXD_VALUED: ReadonlyMap<string, readonly string[]> = new Map([
  ["c", ["ols"]],
  ["g", ["roup"]],
  ["o", ["ffset"]],
  ["s", ["kip", "eek"]],
  ["l", ["en"]],
  ["n", ["ame"]],
  ["R", []],
]);

export const XXD_OPTIONS: OperandToolOptions = {
  // xxd matches each option by its first letter, with one or two dashes.
  takesNextWord(value: string): boolean {
    const word =
      value.startsWith("--") && value.length > 2 ? value.slice(1) : value;
    const rest = word.slice(2);
    if (word.charAt(1) === "c" && rest.startsWith("apitalize")) return false;
    const tails = XXD_VALUED.get(word.charAt(1));
    if (tails === undefined) return false;
    return rest === "" || tails.some((tail) => rest.startsWith(tail));
  },
  permute: false,
};

/** `TOOL [OPTION]... [INPUT [OUTPUT]]` (uniq, xxd): a second operand is a file
 *  the command writes ("-" is standard output). */
export function outputOperandMutation(
  cmd: ShellToken[],
  tool: OperandToolOptions,
): ReadOnlyToolMutation | undefined {
  const output = operandsOf(cmd, tool)[1];
  return output !== undefined && output !== "-"
    ? { writeTargets: [output] }
    : undefined;
}

function operandsOf(cmd: ShellToken[], tool: OperandToolOptions): string[] {
  const operands: string[] = [];
  let options = true;
  for (let index = 1; index < cmd.length; index += 1) {
    const value = elementAt(cmd, index, "cmd").value;
    if (options && value === "--") {
      options = false;
    } else if (options && value.startsWith("-") && value !== "-") {
      if (tool.takesNextWord(value)) index += 1;
    } else {
      operands.push(value);
      options &&= tool.permute;
    }
  }
  return operands;
}
