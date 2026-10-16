// Frame queries that decide whether a heredoc operator opens a start, and which
// substitution a start belongs to.

import { elementAt } from "../element-at.ts";
import type { PendingLine } from "./heredoc-bodies.ts";
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

/** The scan state the dropped starts are read from and written back to. */
export type DropScan = PendingLine &
  Pick<ScanContext, "command" | "i"> & { cursor: number; out: string };

/** Drop the starts opened inside `frame`, whose close the shell reads on
 *  the operator's own line: no body follows them, so each operator and its
 *  delimiter word return to the command as text. */
export function dropSubstitutedStarts(scan: DropScan, frame: Frame): void {
  let first = scan.pending.length;
  while (first > 0 && scan.pending[first - 1]?.frame === frame) first -= 1;
  const dropped = scan.pending.splice(first);
  if (dropped.length === 0) return;
  scan.pieces = scan.pieces.map((piece) => {
    if (!("pendingIndex" in piece) || piece.pendingIndex < first) return piece;
    const start = elementAt(dropped, piece.pendingIndex - first, "dropped");
    return { text: scan.command.slice(start.opStart, start.wordEnd) };
  });
  if (scan.pending.length === 0) {
    // No start remains, so no placeholder is owed: the pieces hold the
    // line's own text again, and the scan passes text through from here.
    for (const piece of scan.pieces) {
      if ("text" in piece) scan.out += piece.text;
    }
    scan.out += scan.command.slice(scan.cursor, scan.i);
    scan.cursor = scan.i;
    scan.pieces = [];
  }
}
