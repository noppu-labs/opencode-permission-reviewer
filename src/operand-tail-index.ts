// Where the command an applet launcher or a root changer runs starts among its words.

import type { ShellToken } from "./shell-token.ts";
import { chrootCommandIndex } from "./shell-wrapper-options.ts";

/** The index where the operand tail of `busybox` or `chroot` at `i` starts,
 *  or `undefined` for any other command. */
export function operandTailIndex(
  words: ShellToken[],
  i: number,
  base: string,
): number | undefined {
  if (base === "busybox") return i + 1;
  if (base === "chroot") return chrootCommandIndex(words, i);
  return undefined;
}
