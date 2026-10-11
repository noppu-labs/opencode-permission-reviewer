import { commandName } from "./brake-arguments.ts";
import {
  isBlockDeviceTarget,
  redirectionWritesBlockDevice,
  redirectTargetsBlockDevice,
} from "./brake-block-device.ts";
import { copyOverwritesBlockDevice } from "./brake-device-copy.ts";
import { formatDestroysDevice } from "./brake-format-tools.ts";
import { PARTITION_TOOL_CHECKS } from "./brake-partition-tools.ts";
import type { Redirection } from "./capability/capability-types.ts";
import { WIPEFS_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

interface DeviceCommand {
  base: string;
  command: readonly ShellToken[];
  args: readonly ShellToken[];
  targetsBlock: boolean;
}

type DeviceCheck = (tool: DeviceCommand) => boolean;

const MKFS_FAMILY = /^mkfs(?:\.[a-z0-9]+)?$/;

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
    return (tool: DeviceCommand) =>
      tool.targetsBlock && formatDestroysDevice(tool.base, tool.args);
  const partition = PARTITION_TOOL_CHECKS.get(base);
  if (partition !== undefined)
    return (tool: DeviceCommand) => tool.targetsBlock && partition(tool.args);
  return DEVICE_TOOL_CHECKS.get(base);
}

function overwritesBlockOperand(tool: DeviceCommand): boolean {
  return tool.targetsBlock;
}

function copiesOntoBlockDevice(tool: DeviceCommand): boolean {
  return copyOverwritesBlockDevice(tool.command, tool.base);
}

/** wipefs with a real block-device target and a signature-erasing option; a
 *  bare wipefs only lists signatures. */
function wipefsWipesSignatures(tool: DeviceCommand): boolean {
  if (!tool.targetsBlock) return false;
  return tool.args.some(({ value }) => wipefsErasingOption(value));
}

/** `--all`, `--types`, `--offset` and the short letters `a`, `t` and `o`
 *  (anywhere in a cluster: `t` and `o` take the rest of it as their value)
 *  erase signatures. */
function wipefsErasingOption(value: string): boolean {
  const long = resolveGnuLongOption(value, WIPEFS_LONG_OPTIONS)?.name;
  if (long === "all" || long === "types" || long === "offset") return true;
  return ["a", "t", "o"].some((letter) =>
    shortFlagClusterIncludes(value, letter),
  );
}

/** dd: detect `of=<real block device>` (the lexer already stripped quotes). */
function ddWritesBlockDevice(tool: DeviceCommand): boolean {
  return tool.args.some(
    (t) => t.value.startsWith("of=") && isBlockDeviceTarget(t.value.slice(3)),
  );
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
