// Frame queries that decide whether a heredoc operator opens a start, and which
// substitution a start belongs to.

import type { Frame, ScanContext } from "./heredoc-scan-context.ts";

/** Whether the shell reads no heredoc body at this `<<`: the operator sits
 *  in an expansion (literal or shift text), or in a construct the scan
 *  cannot follow (unsure text, or backticks). */
export function readsNoBody(scan: ScanContext): boolean {
  return (
    scan.unsure ||
    scan.frames.some(
      (frame) => frame.kind === "expansion" || frame.kind === "backtick",
    )
  );
}

/** The innermost substitution open at the operator, if any. Frames between
 *  it and the operator (groups, expansions) do not change which substitution
 *  closing on the operator's own line ends the operator's heredoc. */
export function enclosingSubstitution(frames: Frame[]): Frame | undefined {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (frame?.kind === "substitution") return frame;
  }
  return undefined;
}
