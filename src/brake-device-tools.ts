import { commandName } from "./brake-arguments.ts";
import {
  isBlockDeviceTarget,
  redirectionWritesBlockDevice,
  redirectTargetsBlockDevice,
} from "./brake-block-device.ts";
import { copyOverwritesBlockDevice } from "./brake-device-copy.ts";
import type { Redirection } from "./capability/capability-types.ts";
import type { ShellToken } from "./shell-token.ts";

interface DeviceCommand {
  base: string;
  command: readonly ShellToken[];
  args: readonly ShellToken[];
  /** Some argument is a real block device. */
  targetsBlock: boolean;
}

type DeviceCheck = (tool: DeviceCommand) => boolean;

const MKFS_FAMILY = /^mkfs(?:\.[a-z0-9]+)?$/;

const SGDISK_ZAP_OPTIONS = new Set(["--zap-all", "-Z", "--zap", "-z"]);

/** One check per executable; base names never overlap. */
const DEVICE_TOOL_CHECKS = new Map<string, DeviceCheck>([
  // tee copies its stdin into every file operand: a real block device
  // operand is a raw overwrite, as unmistakable as shred.
  ["tee", overwritesBlockOperand],
  ["cp", copiesOntoBlockDevice],
  ["install", copiesOntoBlockDevice],
  // shred: any real block target is destruction.
  ["shred", overwritesBlockOperand],
  ["wipefs", wipefsWipesSignatures],
  ["dd", ddWritesBlockDevice],
  ["sgdisk", sgdiskDestroysPartitions],
  ["sfdisk", sfdiskDestroysPartitions],
  ["parted", partedDestroysPartitions],
]);

/**
 * Block-device destruction that is unmistakable regardless of arguments:
 * formatting (`mkfs*`, `mke2fs`, `mkswap`), signature wipe (`wipefs -a`),
 * raw overwrite (`dd of=/dev/…`, `shred /dev/…`), partition-table destruction
 * (`sgdisk --zap-all`/`-z`/`--delete=N`, `sfdisk --delete`/`--wipe`,
 * `parted mklabel`/`rm`). Detected via the lexer so privilege wrappers and
 * `echo "mkfs …"` (where the destructive tool is an argument, not the
 * executable) are handled correctly.
 */
export function commandDestroysDevice(
  command: readonly ShellToken[],
  redirections: readonly Redirection[],
): boolean {
  const base = commandName(command);
  if (base === undefined) return false;
  // Command-string destructuring (`sh -c '… > /dev/sda'`, `script -c …`,
  // ssh remote commands) only surfaces inside the resolved effective
  // commands, so the redirect scan runs on them too.
  if (redirectTargetsBlockDevice(command)) return true;
  if (redirections.some(redirectionWritesBlockDevice)) return true;
  const check = deviceToolCheck(base);
  if (check === undefined) return false;
  const args = command.slice(1);
  return check({
    base,
    command,
    args,
    targetsBlock: args.some((t) => isBlockDeviceTarget(t.value)),
  });
}

function deviceToolCheck(base: string): DeviceCheck | undefined {
  if (MKFS_FAMILY.test(base) || base === "mke2fs" || base === "mkswap")
    return formatsBlockDevice;
  return DEVICE_TOOL_CHECKS.get(base);
}

function overwritesBlockOperand(tool: DeviceCommand): boolean {
  return tool.targetsBlock;
}

function copiesOntoBlockDevice(tool: DeviceCommand): boolean {
  return copyOverwritesBlockDevice(tool.command, tool.base);
}

/** mkfs / mkfs.* / mke2fs / mkswap: any real block target is destruction,
 *  unless a dry-run flag is present (`-n` for mke2fs/mkfs.ext4, `-V`/`-t`
 *  alone do not write but are rare; `-n` is the canonical dry-run). */
function formatsBlockDevice(tool: DeviceCommand): boolean {
  if (!tool.targetsBlock) return false;
  return !tool.args.some((t) => t.value === "-n" || t.value === "--dry-run");
}

/** wipefs: only --all/-a (alone or clustered like `-af`)/-t wipes
 *  signatures; bare wipefs just lists signatures. */
function wipefsWipesSignatures(tool: DeviceCommand): boolean {
  if (!tool.targetsBlock) return false;
  return tool.args.some(
    ({ value: v }) =>
      v === "--all" ||
      v === "-a" ||
      shortFlagClusterIncludes(v, "a") ||
      v.startsWith("-t") ||
      v === "--types",
  );
}

/** dd: detect `of=<real block device>` (the lexer already stripped quotes). */
function ddWritesBlockDevice(tool: DeviceCommand): boolean {
  return tool.args.some(
    (t) => t.value.startsWith("of=") && isBlockDeviceTarget(t.value.slice(3)),
  );
}

/** sgdisk: destructive ops are --zap-all/-Z (wipe everything), -z/--zap
 *  (destroy GPT data structures), and --delete[=N]/-d _N (delete a
 *  partition). -d requires a following partition-number argument. */
function sgdiskDestroysPartitions(tool: DeviceCommand): boolean {
  if (!tool.targetsBlock) return false;
  const destructive = tool.args.some(
    (t) => SGDISK_ZAP_OPTIONS.has(t.value) || t.value.startsWith("--delete"),
  );
  const deleteShort = tool.args.some((t) => t.value === "-d");
  return (
    destructive ||
    (deleteShort && tool.args.some((t) => /^[0-9]+$/.test(t.value)))
  );
}

/** sfdisk: --delete (with partition list) and --wipe* destroy data.
 *  NOTE: sfdisk's `-d` is `--dump` (read-only backup), NOT delete — do not
 *  share the sgdisk short-flag set. */
function sfdiskDestroysPartitions(tool: DeviceCommand): boolean {
  if (!tool.targetsBlock) return false;
  return tool.args.some(
    (t) => t.value === "--delete" || t.value.startsWith("--wipe"),
  );
}

/** parted: `mklabel` rewrites the partition table; `rm N` deletes a
 *  partition. */
function partedDestroysPartitions(tool: DeviceCommand): boolean {
  if (!tool.targetsBlock) return false;
  return tool.args.some((t) => t.value === "mklabel" || t.value === "rm");
}

/** Whether a short-flag cluster (e.g. `-af`) contains a given flag letter. */
function shortFlagClusterIncludes(value: string, letter: string): boolean {
  return (
    value.startsWith("-") &&
    !value.startsWith("--") &&
    value.length > 1 &&
    value.includes(letter)
  );
}
