// Frame queries that decide whether a heredoc operator opens a start, and which
// substitution a start belongs to.

import { elementAt } from "../element-at.ts";
import type { PendingLine } from "./heredoc-bodies.ts";
import {
  closingFrame,
  type Frame,
  fallBackFromArithmetic,
  type ScanContext,
} from "./heredoc-scan-context.ts";

/** Whether the shell reads no heredoc body at this `<<`. The nearest
 *  expansion, substitution or backtick open at the operator decides: an
 *  expansion reads `<<` as literal or shift text, while a substitution or
 *  backtick reads a body from the lines after it. No such frame reads a
 *  body. */
export function readsNoBody(scan: ScanContext): boolean {
  const body = scan.frames.at(-1)?.bodyAt ?? -1;
  return body >= 0 && scan.frames[body]?.kind === "expansion";
}

/** The innermost substitution or backtick open at the operator, if any.
 *  Frames between it and the operator (groups, expansions) do not change
 *  which substitution closing on the operator's own line ends the operator's
 *  heredoc. */
export function enclosingSubstitution(frames: Frame[]): Frame | undefined {
  const index = frames.at(-1)?.subst ?? -1;
  return index < 0 ? undefined : frames[index];
}

/** The scan state the dropped starts are read from and written back to. */
export type DropScan = PendingLine &
  Pick<ScanContext, "command" | "i"> & { cursor: number; out: string };

/** Drop the starts opened inside `frame`, whose close the shell reads on
 *  the operator's own line: no body follows them, so each operator and its
 *  delimiter word return to the command as text. */
function dropSubstitutedStarts(scan: DropScan, frame: Frame): void {
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

/** At the closing backtick of the innermost backtick frame, the shell ends the
 *  backtick text first: every construct still open inside it closes as well,
 *  and the quote it opened in is cleared. The starts opened inside the closed
 *  constructs drop as on a same-line close. Returns false when `scan.i` is
 *  not that closing backtick. */
export function closeBacktickFrames(scan: DropScan & ScanContext): boolean {
  const frame = scan.frames[scan.backtickAt];
  if (scan.backtickAt < 0 || frame === undefined || frame.limit !== scan.i)
    return false;
  const closed = scan.frames.splice(scan.backtickAt);
  scan.backtickAt = -1;
  scan.quote = frame.quote;
  scan.i += 1;
  for (const closedFrame of closed.reverse()) {
    if (closedFrame.kind === "substitution" || closedFrame.kind === "backtick")
      dropSubstitutedStarts(scan, closedFrame);
  }
  return true;
}

/** Close the construct ending at `scan.i`, or fall back a lone `)` out of
 *  arithmetic. A substitution or backtick that ends on the operator's own
 *  line ends no heredoc: the shell reads the close before any body line, so
 *  the starts opened inside it are dropped and their operator text stays in
 *  the command. */
export function closeFrame(
  scan: DropScan & ScanContext & { readAllOperators: boolean },
): boolean {
  const frame = closingFrame(scan);
  if (frame === undefined) return fallBackFromArithmetic(scan);
  scan.frames.pop();
  if (frame.kind === "backtick") scan.backtickAt = -1;
  scan.quote = frame.quote;
  scan.i += frame.close.length;
  if (
    !scan.readAllOperators &&
    (frame.kind === "substitution" || frame.kind === "backtick")
  )
    dropSubstitutedStarts(scan, frame);
  return true;
}
