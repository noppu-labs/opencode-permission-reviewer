import { splitArguments } from "./brake-arguments.ts";
import { RM_LONG_OPTIONS } from "./gnu-long-option-tables.ts";
import { resolveGnuLongOption } from "./gnu-long-options.ts";
import type { ShellToken } from "./shell-token.ts";

interface RmFlags {
  recursive: boolean;
  force: boolean;
  /** Only the full spelling counts: an abbreviated `--no-preserve-root` is
   *  rejected by rm. A later `--preserve-root` clears it. */
  noPreserveRoot: boolean;
}

/** Long options resolve like getopt_long, abbreviations included; options
 *  after `--` are operands (`splitArguments`). */
export function hasRmFlags(command: readonly ShellToken[]): RmFlags {
  const flags: RmFlags = {
    recursive: false,
    force: false,
    noPreserveRoot: false,
  };
  for (const { value } of splitArguments(command).options) {
    if (value.startsWith("--")) applyRmLongOption(flags, value);
    else applyRmShortCluster(flags, value);
  }
  return flags;
}

function applyRmLongOption(flags: RmFlags, option: string): void {
  switch (resolveGnuLongOption(option, RM_LONG_OPTIONS)?.name) {
    case "recursive":
      flags.recursive = true;
      break;
    case "force":
      flags.force = true;
      break;
    case "no-preserve-root":
      flags.noPreserveRoot = option === "--no-preserve-root";
      break;
    case "preserve-root":
      flags.noPreserveRoot = false;
      break;
    default:
      break;
  }
}

/** Clustered short flags; GNU rm allows them interleaved with operands. */
function applyRmShortCluster(flags: RmFlags, cluster: string): void {
  if (cluster.includes("r") || cluster.includes("R")) flags.recursive = true;
  if (cluster.includes("f")) flags.force = true;
}
