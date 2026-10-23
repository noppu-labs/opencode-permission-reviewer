// Whether a `$((` is arithmetic, by the frames the substitution end-finder already closed.

import type { FrameCloses } from "./shell-substitution.ts";

/** Whether the `$((` at `index` is arithmetic, by the frames the end-finder
 *  already closed: its subshell frame closes right before its own. */
export function knownArithmetic(closes: FrameCloses, index: number): boolean {
  const outer = closes.get(index) ?? closes.get(index + 1);
  const inner = closes.get(index + 2);
  return outer !== undefined && inner !== undefined && outer === inner + 1;
}
