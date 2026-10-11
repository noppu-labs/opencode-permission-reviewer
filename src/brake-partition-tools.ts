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

/** sgdisk with a zap or partition-delete option. */
function sgdiskDestroysPartitions(args: readonly ShellToken[]): boolean {
  const destructive = args.some(
    (t) => SGDISK_ZAP_OPTIONS.has(t.value) || t.value.startsWith("--delete"),
  );
  const deleteShort = args.some((t) => t.value === "-d");
  return (
    destructive || (deleteShort && args.some((t) => /^[0-9]+$/.test(t.value)))
  );
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
