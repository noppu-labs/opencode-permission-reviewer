// Puts the segments a walk produced into the shape `scriptFeeds` reads: which effective command each pipe feeds, and the placeholder of each heredoc.

import { holdsGluedPlaceholder } from "../capability/heredoc/heredoc-scripts.ts";
import {
  heredocPlaceholders,
  type ShellRedirection,
} from "./shell-redirections.ts";
import {
  type ScriptFeedInput,
  type ScriptFeedResult,
  type StdinReader,
  scriptFeeds,
} from "./shell-script-feeds.ts";
import type { ScriptRedirection } from "./shell-stdin-source.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";

/** One lexed segment with what the walk gave for it. */
export interface SegmentFeedParts {
  segment: ShellSegment;
  effective: readonly (readonly ShellToken[])[];
  redirections: readonly (readonly ShellRedirection[])[];
  /** Every redirection the segment and its command strings carry, once
   *  each: the lists above take theirs from it. */
  segmentRedirections: readonly ShellRedirection[];
  /** The redirections of each ssh in it that has no remote command. */
  bareSsh: readonly (readonly ShellRedirection[])[];
  /** The redirections of each shell in it run with `-c` and `-s`. */
  stdinShells: readonly (readonly ShellRedirection[])[];
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
  const marks: (readonly (string | undefined)[])[] = [];
  const pipedFrom: (number | undefined)[] = [];
  const remote: StdinReader[] = [];
  const shells: StdinReader[] = [];
  parts.forEach((part, index) => {
    const placeholders = heredocPlaceholders(part.segment.tokens);
    const producer = producers[index];
    part.effective.forEach((words, at) => {
      effective.push(words);
      redirections.push(part.redirections[at] ?? []);
      marks.push(placeholders);
      pipedFrom.push(producer);
    });
    for (const own of part.bareSsh)
      remote.push({ redirections: own, pipedFrom: producer, placeholders });
    for (const own of part.stdinShells)
      shells.push({ redirections: own, pipedFrom: producer, placeholders });
  });
  return {
    effective,
    redirections,
    pipedFrom,
    placeholders: marks,
    scripts,
    remote,
    shells,
    glued: scripts.size > 0 && parts.some(hasGluedWord),
  };
}

/** Whether a word of the segment holds a placeholder together with other
 *  text, which only a command lexed without `separatePlaceholders` has. */
function hasGluedWord({ segment }: SegmentFeedParts): boolean {
  return segment.tokens.some((token) => holdsGluedPlaceholder(token.value));
}

/** For each effective command of `segments` (`counts[k]` of them in segment
 *  `k`), the index of the effective command whose stdout feeds it through a
 *  `|` or `|&`, or `undefined`. The producer is the one command of the
 *  segment right before it, when that segment ended in a pipe: the segment
 *  after a pipe that ends a line starts after a newline, and the shell still
 *  reads it as the pipe's consumer. */
export function pipedFromSegments(
  segments: readonly Pick<ShellSegment, "endedBy">[],
  counts: readonly number[],
): (number | undefined)[] {
  const producers = segmentProducers(segments, counts);
  return counts.flatMap((count, index) =>
    Array.from({ length: count }, () => producers[index]),
  );
}

/** Per segment, the index of the effective command that pipes into it. */
function segmentProducers(
  segments: readonly Pick<ShellSegment, "endedBy">[],
  counts: readonly number[],
): (number | undefined)[] {
  const producers: (number | undefined)[] = [];
  let start = 0;
  let previousStart = 0;
  segments.forEach((_, index) => {
    const before = segments[index - 1];
    const single = counts[index - 1] === 1;
    producers.push(
      single && before !== undefined && isPipe(before.endedBy)
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
