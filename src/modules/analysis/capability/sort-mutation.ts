import { elementAt } from "../../../utils/element-at.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import { longOption } from "./getopt-long-option.ts";
import type { ReadOnlyToolMutation } from "./models/read-only-tool-mutation.ts";

/** GNU sort short options that take a value. The value is the rest of the
 *  cluster, or the next word when the letter ends it. */
const SORT_VALUED_LETTERS = "kotST";

/** GNU sort: `-o FILE` writes FILE and `--compress-program=PROG` runs PROG.
 *  Short options cluster getopt-style (`-uo FILE`, `-nruoFILE`), and long
 *  options may be abbreviated (`--out=FILE`). */
export function sortMutation(
  cmd: ShellToken[],
): ReadOnlyToolMutation | undefined {
  const result: ReadOnlyToolMutation = { writeTargets: [] };
  let index = 1;
  while (index < cmd.length) {
    const value = elementAt(cmd, index, "cmd").value;
    if (value === "--") break;
    index += value.startsWith("--")
      ? sortLongOption(cmd, index, result)
      : sortShortOptions(cmd, index, result);
  }
  return result.writeTargets.length > 0 || result.executesCode === true
    ? result
    : undefined;
}

/** Record a long option's effect; returns the words it spans. */
function sortLongOption(
  cmd: ShellToken[],
  index: number,
  result: ReadOnlyToolMutation,
): number {
  const value = elementAt(cmd, index, "cmd").value;
  // "--o" is the shortest unambiguous prefix of --output, "--co" of
  // --compress-program (--check also starts with "--c").
  const output = longOption(value, "--output", 3);
  if (output !== undefined) {
    const target = output.inline ?? cmd[index + 1]?.value;
    if (target !== undefined) result.writeTargets.push(target);
    return output.inline === undefined ? 2 : 1;
  }
  if (longOption(value, "--compress-program", 4) !== undefined)
    result.executesCode = true;
  return 1;
}

/** Record a short-option cluster's output file; returns the words it spans. */
function sortShortOptions(
  cmd: ShellToken[],
  index: number,
  result: ReadOnlyToolMutation,
): number {
  const value = elementAt(cmd, index, "cmd").value;
  if (!value.startsWith("-") || value === "-") return 1;
  for (let at = 1; at < value.length; at += 1) {
    const letter = value.charAt(at);
    if (!SORT_VALUED_LETTERS.includes(letter)) continue;
    const attached = value.slice(at + 1);
    const argument = attached === "" ? cmd[index + 1]?.value : attached;
    if (letter === "o" && argument !== undefined)
      result.writeTargets.push(argument);
    return attached === "" ? 2 : 1;
  }
  return 1;
}
