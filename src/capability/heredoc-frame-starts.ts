// Frame queries that decide whether a heredoc operator opens a start, and which
// substitution a start belongs to.

import type { Frame, ScanContext } from "./heredoc-scan-context.ts";

/** Whether the shell reads no heredoc body at this `<<`. The nearest
 *  expansion, substitution or backtick open at the operator decides: an
 *  expansion reads `<<` as literal or shift text, while a substitution or
 *  backtick reads a body from the lines after it. No such frame reads a body. */
export function readsNoBody(scan: ScanContext): boolean {
  for (let i = scan.frames.length - 1; i >= 0; i -= 1) {
    const kind = scan.frames[i]?.kind;
    if (kind === "expansion") return true;
    if (kind === "substitution" || kind === "backtick") return false;
  }
  return false;
}

/** The innermost substitution or backtick open at the operator, if any.
 *  Frames between it and the operator (groups, expansions) do not change
 *  which substitution closing on the operator's own line ends the operator's
 *  heredoc. */
export function enclosingSubstitution(frames: Frame[]): Frame | undefined {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (frame?.kind === "substitution" || frame?.kind === "backtick")
      return frame;
  }
  return undefined;
}
