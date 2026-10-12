import { SFDISK_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

type PartitionCheck = (args: readonly ShellToken[]) => boolean;

const SGDISK_ZAP_OPTIONS = new Set(["--zap-all", "--zap"]);

/** The sgdisk (popt) short options that take a value. */
const SGDISK_VALUE_LETTERS = new Set(
  "A a b B c d h i j k l m n N r R S t T u U".split(" "),
);

/** The sfdisk short options that take a value (`o:O:N:u:X:Y:w:W:`). */
const SFDISK_VALUE_LETTERS = new Set(["o", "O", "N", "u", "X", "Y", "w", "W"]);

/** Option checks for the partition-table tools. Each one is applied only when
 *  the command targets a real block device. */
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

function isShortCluster(value: string): boolean {
  return value.startsWith("-") && !value.startsWith("--") && value.length > 1;
}

function endsWithDeleteLetter(value: string): boolean {
  return isShortCluster(value) && value.endsWith("d");
}

/** A short cluster that ends in `d` followed by digits, e.g. `-d1`, `-pd12`. */
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

/** sfdisk: --delete (with partition list) and --wipe* (`-w`, `-W`) destroy
 *  data.
 *  NOTE: sfdisk's `-d` is `--dump` (read-only backup), NOT delete — do not
 *  share the sgdisk short-flag set. */
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
  return args.some((t) => t.value === "mklabel" || t.value === "rm");
}
