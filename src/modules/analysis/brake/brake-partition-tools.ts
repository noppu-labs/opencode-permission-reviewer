import type { ShellToken } from "../shell/shell-token.ts";
import { SFDISK_LONG_OPTIONS } from "../walk/gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "../walk/gnu-long-options.ts";
import { isShortCluster } from "./brake-arguments.ts";

type PartitionCheck = (args: readonly ShellToken[]) => boolean;

const SGDISK_ZAP_OPTIONS = new Set(["--zap-all", "--zap"]);

/** The sgdisk (popt) short options that take a value. */
const SGDISK_VALUE_LETTERS = new Set(
  "A a b B c d h i j k l m n N r R S t T u U".split(" "),
);

/** The sfdisk short options that take a value (`o:O:N:u:X:Y:w:W:`). */
const SFDISK_VALUE_LETTERS = new Set(["o", "O", "N", "u", "X", "Y", "w", "W"]);

/** GNU parted's commands (parted/parted.c `_init_commands`), each with all of
 *  its names. */
const PARTED_COMMANDS: readonly (readonly string[])[] = [
  ["align-check"],
  ["help"],
  ["mklabel", "mktable"],
  ["mkpart"],
  ["name"],
  ["print"],
  ["quit"],
  ["rescue"],
  ["resize"],
  ["resizepart"],
  ["rm"],
  ["select"],
  ["disk_set"],
  ["disk_toggle"],
  ["set"],
  ["toggle"],
  ["type"],
  ["unit"],
  ["version"],
];

/** Each check runs only when the command targets a real block device:
 *  `deviceToolCheck` adds that guard. */
export const PARTITION_TOOL_CHECKS = new Map<string, PartitionCheck>([
  ["sgdisk", sgdiskDestroysPartitions],
  ["sfdisk", sfdiskDestroysPartitions],
  ["parted", partedDestroysPartitions],
]);

/** sgdisk's `-d` takes the partition number glued (`-d1`, `-pd1`) or as the
 *  next word; a delete flag without a number deletes nothing. */
function sgdiskDestroysPartitions(args: readonly ShellToken[]): boolean {
  const destructive = args.some(
    ({ value }) =>
      SGDISK_ZAP_OPTIONS.has(value) ||
      value === "--clear" ||
      value.startsWith("--delete") ||
      deleteLetterWithNumber(value) ||
      clusterReaches(value, "oZz", SGDISK_VALUE_LETTERS),
  );
  const deleteShort = args.some(({ value }) => endsWithDeleteLetter(value));
  return destructive || (deleteShort && args.some((t) => isAllDigits(t.value)));
}

function endsWithDeleteLetter(value: string): boolean {
  return isShortCluster(value) && value.endsWith("d");
}

function deleteLetterWithNumber(value: string): boolean {
  if (!isShortCluster(value)) return false;
  let digitsStart = value.length;
  while (digitsStart > 1 && isAllDigits(value[digitsStart - 1] ?? ""))
    digitsStart -= 1;
  return (
    digitsStart < value.length &&
    endsWithDeleteLetter(value.slice(0, digitsStart))
  );
}

function isAllDigits(value: string): boolean {
  return value !== "" && [...value].every((c) => c >= "0" && c <= "9");
}

/** sfdisk's `-d` is `--dump` (read-only), not delete: never share the sgdisk
 *  letter sets. `--delete` and the wipe options (`-w`, `-W`) destroy data. */
function sfdiskDestroysPartitions(args: readonly ShellToken[]): boolean {
  return args.some((t) => {
    const long = resolveGnuLongOption(t.value, SFDISK_LONG_OPTIONS)?.name;
    return (
      long === "delete" ||
      long?.startsWith("wipe") === true ||
      clusterReaches(t.value, "wW", SFDISK_VALUE_LETTERS)
    );
  });
}

/** Whether a short cluster reaches one of `letters` before a letter that
 *  takes a value, which takes the rest of the cluster with it. */
function clusterReaches(
  value: string,
  letters: string,
  valueLetters: ReadonlySet<string>,
): boolean {
  if (!isShortCluster(value)) return false;
  for (const letter of value.slice(1)) {
    if (letters.includes(letter)) return true;
    if (valueLetters.has(letter)) return false;
  }
  return false;
}

/** parted: `mklabel` rewrites the partition table; `rm N` deletes a
 *  partition. */
function partedDestroysPartitions(args: readonly ShellToken[]): boolean {
  return args.some((t) => {
    const command = partedCommand(t.value);
    return command === "mklabel" || command === "rm";
  });
}

/** Resolves a word as parted's `command_get` does: a case-insensitive exact
 *  name first, else a prefix of one command's names only. */
function partedCommand(word: string): string | undefined {
  const lower = word.toLowerCase();
  const exact = PARTED_COMMANDS.find((names) => names.includes(lower));
  if (exact !== undefined) return exact[0];
  const partial = PARTED_COMMANDS.filter((names) =>
    names.some((name) => name.startsWith(lower)),
  );
  return partial.length === 1 ? partial[0]?.[0] : undefined;
}
