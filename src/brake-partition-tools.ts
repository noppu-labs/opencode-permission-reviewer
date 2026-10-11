import { SFDISK_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

type PartitionCheck = (args: readonly ShellToken[]) => boolean;

const SGDISK_ZAP_OPTIONS = new Set(["--zap-all", "-Z", "--zap", "-z"]);

/** Option checks for the partition-table tools. Each one is applied only when
 *  the command targets a real block device. */
export const PARTITION_TOOL_CHECKS = new Map<string, PartitionCheck>([
  ["sgdisk", sgdiskDestroysPartitions],
  ["sfdisk", sfdiskDestroysPartitions],
  ["parted", partedDestroysPartitions],
]);

/** sgdisk with a zap option or a partition delete: `-d` (alone or ending a
 *  short cluster) with a separate number word, or `d` followed by its number
 *  inside a cluster (`-d1`, `-pd1`). A delete flag without a number deletes
 *  nothing. */
function sgdiskDestroysPartitions(args: readonly ShellToken[]): boolean {
  const destructive = args.some(
    ({ value }) =>
      SGDISK_ZAP_OPTIONS.has(value) ||
      value.startsWith("--delete") ||
      deleteLetterWithNumber(value),
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

/** sfdisk: --delete (with partition list) and --wipe* destroy data.
 *  NOTE: sfdisk's `-d` is `--dump` (read-only backup), NOT delete — do not
 *  share the sgdisk short-flag set. */
function sfdiskDestroysPartitions(args: readonly ShellToken[]): boolean {
  return args.some((t) => {
    const long = resolveGnuLongOption(t.value, SFDISK_LONG_OPTIONS)?.name;
    return long === "delete" || long?.startsWith("wipe") === true;
  });
}

/** parted: `mklabel` rewrites the partition table; `rm N` deletes a
 *  partition. */
function partedDestroysPartitions(args: readonly ShellToken[]): boolean {
  return args.some((t) => t.value === "mklabel" || t.value === "rm");
}
