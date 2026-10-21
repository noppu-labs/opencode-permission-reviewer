// Links between a heredoc scan frame and the frames below it: each frame records
// where its nearest substitution, bounded construct and body-reading construct
// sit in the stack, so the frame queries read the top frame in constant time.

import type { Frame, ScanContext } from "./heredoc-scan-context.ts";

/** A frame before its links to the frames below it are set. */
export type FrameSpec = Omit<Frame, "subst" | "limitAt" | "bodyAt">;

/** The frame `spec` makes at stack `index`, with its links taken from the frame
 *  below it (already linked). */
export function linkFrame(
  frames: readonly Frame[],
  index: number,
  spec: FrameSpec,
): Frame {
  const parent = index > 0 ? frames[index - 1] : undefined;
  const substitution = spec.kind === "substitution" || spec.kind === "backtick";
  return {
    ...spec,
    subst: substitution ? index : (parent?.subst ?? -1),
    limitAt: spec.limit !== undefined ? index : (parent?.limitAt ?? -1),
    bodyAt:
      substitution || spec.kind === "expansion"
        ? index
        : (parent?.bodyAt ?? -1),
  };
}

export function pushFrame(scan: ScanContext, spec: FrameSpec): void {
  scan.frames.push(linkFrame(scan.frames, scan.frames.length, spec));
}
