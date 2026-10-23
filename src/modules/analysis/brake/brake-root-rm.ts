import type { ShellToken } from "../shell/shell-token.ts";
import { commandName, splitArguments } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import { isLiveRootGlob, resolvesToRoot } from "./brake-root-target.ts";

export function isRootRm(command: ShellToken[]): boolean {
  if (commandName(command) !== "rm") return false;
  const flags = hasRmFlags(command);
  if (!flags.recursive) return false;
  const rootProtectionOff = flags.force || flags.noPreserveRoot;
  return splitArguments(command).operands.some(
    (operand) =>
      isLiveRootGlob(operand) ||
      (rootProtectionOff && resolvesToRoot(operand.value)),
  );
}
