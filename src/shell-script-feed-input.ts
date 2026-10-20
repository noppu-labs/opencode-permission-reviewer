// Puts the segments a walk produced into the shape `scriptFeeds` reads: which effective command each pipe feeds, and the placeholder of each heredoc.

import {
  heredocPlaceholders,
  type ShellRedirection,
} from "./shell-redirections.ts";
import {
  type RemoteReader,
  type ScriptFeedInput,
  type ScriptFeedResult,
  scriptFeeds,
} from "./shell-script-feeds.ts";
import type { ScriptRedirection } from "./shell-stdin-source.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";

/** One lexed segment with what the walk gave for it. */
export interface SegmentFeedParts {
  segment: ShellSegment;
  effective: readonly (readonly ShellToken[])[];
  redirections: readonly (readonly ShellRedirection[])[];
  /** The redirections of each ssh in it that has no remote command. */
  bareSsh: readonly (readonly ShellRedirection[])[];
}

/** The scripts that run for the segments of one command, under the heredoc
 *  bodies recorded in `scripts`. */
export function scriptFeedsOfSegments(
  parts: readonly SegmentFeedParts[],
  scripts: ReadonlyMap<string, readonly string[]>,
): ScriptFeedResult {
  return scriptFeeds(buildFeedInput(parts, scripts));
}

export function buildFeedInput(
  parts: readonly SegmentFeedParts[],
  scripts: ReadonlyMap<string, readonly string[]>,
): ScriptFeedInput {
  const segments = parts.map(({ segment }) => segment);
  const counts = parts.map(({ effective }) => effective.length);
  const producers = segmentProducers(segments, counts);
  const effective: (readonly ShellToken[])[] = [];
  const redirections: (readonly ScriptRedirection[])[] = [];
  const pipedFrom: (number | undefined)[] = [];
  const remote: RemoteReader[] = [];
  parts.forEach((part, index) => {
    const placeholders = heredocPlaceholders(part.segment.tokens);
    const producer = producers[index];
    part.effective.forEach((words, at) => {
      effective.push(words);
      redirections.push(
        markRedirections(part.redirections[at] ?? [], placeholders),
      );
      pipedFrom.push(producer);
    });
    for (const own of part.bareSsh)
      remote.push({
        redirections: markRedirections(own, placeholders),
        pipedFrom: producer,
      });
  });
  return { effective, redirections, pipedFrom, scripts, remote };
}

/** `redirections` with the placeholder of each heredoc among the first of
 *  them, which are the segment's own: `placeholders[k]` is the one of
 *  redirection `k`. Without placeholders the list is returned as it is. */
export function markRedirections(
  redirections: readonly ShellRedirection[],
  placeholders: readonly (string | undefined)[],
): readonly ScriptRedirection[] {
  if (placeholders.length === 0) return redirections;
  return redirections.map((redirection, index) => {
    const placeholder = placeholders[index];
    return placeholder === undefined
      ? redirection
      : { ...redirection, placeholder };
  });
}

/** For each effective command of `segments` (`counts[k]` of them in segment
 *  `k`), the index of the effective command whose stdout feeds it through a
 *  `|` or `|&`, or `undefined`. The producer is the one command of the
 *  segment right before it, when that segment ended in the same pipe. */
export function pipedFromSegments(
  segments: readonly Pick<ShellSegment, "precededBy" | "endedBy">[],
  counts: readonly number[],
): (number | undefined)[] {
  const producers = segmentProducers(segments, counts);
  return counts.flatMap((count, index) =>
    Array.from({ length: count }, () => producers[index]),
  );
}

/** Per segment, the index of the effective command that pipes into it. */
function segmentProducers(
  segments: readonly Pick<ShellSegment, "precededBy" | "endedBy">[],
  counts: readonly number[],
): (number | undefined)[] {
  const producers: (number | undefined)[] = [];
  let start = 0;
  let previousStart = 0;
  segments.forEach((segment, index) => {
    const before = segments[index - 1];
    const single = counts[index - 1] === 1;
    producers.push(
      single &&
        before !== undefined &&
        isPipe(segment.precededBy) &&
        isPipe(before.endedBy)
        ? previousStart
        : undefined,
    );
    previousStart = start;
    start += counts[index] ?? 0;
  });
  return producers;
}

function isPipe(separator: string | undefined): boolean {
  return separator === "|" || separator === "|&";
}
