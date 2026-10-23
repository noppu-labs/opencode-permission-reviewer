import { elementAt } from "../../../utils/element-at.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import {
  CP_LONG_OPTIONS,
  INSTALL_LONG_OPTIONS,
} from "../walk/gnu-long-option-tables.ts";
import {
  type LongOption,
  resolveGnuLongOption,
} from "../walk/gnu-long-options.ts";
import { isOptionWord } from "./brake-arguments.ts";
import { isBlockDeviceTarget } from "./brake-block-device.ts";

const CP_VALUE_OPTIONS = new Set(["-S", "-t"]);

const INSTALL_VALUE_OPTIONS = new Set(["-g", "-m", "-o", "-S", "-t"]);

interface CopyArguments {
  operands: string[];
  targetDirectory: boolean;
}

/** `cp SOURCE DEVICE` and `install SOURCE DEVICE` open the final operand for
 *  writing just like an output redirection. Parse their value-taking options
 *  so an option argument that merely resembles a device is never mistaken for
 *  the destination. Target-directory forms point at a directory and cannot
 *  directly overwrite a block device. */
export function copyOverwritesBlockDevice(
  command: readonly ShellToken[],
  base: string,
): boolean {
  const { operands, targetDirectory } =
    base === "cp"
      ? parseCopyArguments(command, CP_VALUE_OPTIONS, CP_LONG_OPTIONS)
      : parseCopyArguments(
          command,
          INSTALL_VALUE_OPTIONS,
          INSTALL_LONG_OPTIONS,
        );
  const destination = operands.at(-1);
  return (
    !targetDirectory &&
    operands.length >= 2 &&
    destination !== undefined &&
    isBlockDeviceTarget(destination)
  );
}

function parseCopyArguments(
  command: readonly ShellToken[],
  valueOptions: ReadonlySet<string>,
  longOptions: readonly LongOption[],
): CopyArguments {
  const parsed: CopyArguments = { operands: [], targetDirectory: false };
  let endOfOptions = false;
  for (let index = 1; index < command.length; index += 1) {
    const value = elementAt(command, index, "command").value;
    if (endOfOptions || !isOptionWord(value)) parsed.operands.push(value);
    else if (value === "--") endOfOptions = true;
    else if (value.startsWith("--"))
      index += applyLongOption(parsed, value, longOptions);
    else index += applyShortCluster(parsed, value, valueOptions);
  }
  return parsed;
}

/** Records a long option and returns how many following words it consumes
 *  as its value. */
function applyLongOption(
  parsed: CopyArguments,
  value: string,
  longOptions: readonly LongOption[],
): number {
  const option = resolveGnuLongOption(value, longOptions);
  if (option === undefined) return 0;
  if (option.name === "target-directory") parsed.targetDirectory = true;
  return option.argument === "required" && !option.inlineValue ? 1 : 0;
}

/** Records the first value-taking option in a short cluster and returns how
 *  many following words it consumes: one when it ends the cluster, none when
 *  its value is glued on. */
function applyShortCluster(
  parsed: CopyArguments,
  cluster: string,
  valueOptions: ReadonlySet<string>,
): number {
  for (let position = 1; position < cluster.length; position += 1) {
    const option = `-${cluster.charAt(position)}`;
    if (!valueOptions.has(option)) continue;
    if (option === "-t") parsed.targetDirectory = true;
    return position === cluster.length - 1 ? 1 : 0;
  }
  return 0;
}
