import { splitArguments } from "./brake-arguments.ts";
import type { ShellToken } from "./shell-token.ts";

interface RmFlags {
  recursive: boolean;
  force: boolean;
}

/** Whether an `rm` command's options make it recursive and forceful, given
 *  alone or clustered (e.g. `-rf`). Options after `--` are operands. */
export function hasRmFlags(command: readonly ShellToken[]): RmFlags {
  const flags: RmFlags = { recursive: false, force: false };
  for (const { value } of splitArguments(command).options) {
    if (value.startsWith("--")) applyRmLongOption(flags, value);
    else applyRmShortCluster(flags, value);
  }
  return flags;
}

function applyRmLongOption(flags: RmFlags, option: string): void {
  if (option === "--recursive") flags.recursive = true;
  else if (option === "--force") flags.force = true;
}

/** Clustered short flags; GNU rm allows them interleaved with operands. */
function applyRmShortCluster(flags: RmFlags, cluster: string): void {
  if (cluster.includes("r") || cluster.includes("R")) flags.recursive = true;
  if (cluster.includes("f")) flags.force = true;
}
