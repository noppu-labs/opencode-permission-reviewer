// Walking lexed segments into effective commands and redirections.

import { elementAt } from "../../../utils/element-at.ts";
import { analyzeSegmentRedirections } from "../shell/shell-effective-commands.ts";
import type { AnalysisBudget } from "../shell/shell-lexer.ts";
import type { SegmentFeedParts } from "../shell/shell-script-feed-input.ts";
import type { ShellSegment, ShellToken } from "../shell/shell-token.ts";
import type { PeeledHead } from "../walk/walk-sink.ts";
import type { Redirection } from "./models/capability-types.ts";

/** What a walk collects: the segments, the effective command of each and its
 *  redirections, and whether any limit stopped the analysis short. */
export interface Walked {
  segments: ShellSegment[];
  effective: ShellToken[][];
  redirections: Redirection[][];
  truncated: boolean;
  /** What the walk gave for each segment, as the script feeds read it. */
  parts: SegmentFeedParts[];
  /** The effective commands that run on the far side of an ssh with no
   *  remote command, from the script it reads. */
  remote: ShellToken[][];
  /** An interpreter among the commands runs code from a heredoc or
   *  here-string. */
  stdinCode: boolean;
  /** Every command the walks resolve, wrapper or not, in walk order. */
  heads: PeeledHead[];
}

export function newWalked(): Walked {
  return {
    segments: [],
    effective: [],
    redirections: [],
    truncated: false,
    parts: [],
    remote: [],
    stdinCode: false,
    heads: [],
  };
}

/** Walk `segments` into `into` under the shared `budget`. Returns whether a
 *  limit stopped this walk short. */
export function walkSegments(
  segments: ShellSegment[],
  budget: AnalysisBudget,
  into: Walked,
): boolean {
  let stopped = false;
  for (const segment of segments) {
    into.segments.push(segment);
    const analysis = analyzeSegmentRedirections(segment, budget, into.heads);
    into.parts.push({
      segment,
      effective: analysis.commands,
      redirections: analysis.redirections,
      segmentRedirections: analysis.segmentRedirections,
      bareSsh: analysis.bareSsh,
      stdinShells: analysis.stdinShells,
    });
    stopped = stopped || analysis.truncated;
    for (const [index, cmd] of analysis.commands.entries()) {
      into.effective.push(cmd);
      into.redirections.push(
        elementAt(analysis.redirections, index, "analysis.redirections"),
      );
    }
  }
  return stopped;
}
