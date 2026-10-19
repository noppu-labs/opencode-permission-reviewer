// Walking lexed segments into effective commands and redirections, and walking the commands that heredoc bodies run after them.

import { elementAt } from "../element-at.ts";
import { analyzeEffectiveCommands } from "../shell-effective-commands.ts";
import { type AnalysisBudget, lexSegmentsBounded } from "../shell-lexer.ts";
import type { ShellSegment, ShellToken } from "../shell-token.ts";
import type { Redirection } from "./capability-types.ts";
import { MAX_BODY_DEPTH } from "./heredoc-body-commands.ts";

/** What a walk collects: the segments, the effective command of each and its
 *  redirections, and whether any limit stopped the analysis short. */
export interface Walked {
  segments: ShellSegment[];
  effective: ShellToken[][];
  redirections: Redirection[][];
  truncated: boolean;
}

export function newWalked(): Walked {
  return { segments: [], effective: [], redirections: [], truncated: false };
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
    const analysis = analyzeEffectiveCommands(segment, budget);
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

interface Queued {
  command: string;
  level: number;
}

/**
 * Walk the commands that heredoc bodies run, each lexed as a command line of
 * its own, after the command's own. A command's lexed segments may hold
 * heredocs of their own (in a double-quoted substitution), whose commands
 * run one level deeper; past `MAX_BODY_DEPTH` levels, or when a body has no
 * end to read, the analysis is incomplete. A limit that stops a walk stops
 * the rest, which shares the one budget.
 */
export function walkBodyCommands(
  commands: string[],
  unresolved: boolean,
  budget: AnalysisBudget,
  into: Walked,
): void {
  into.truncated = into.truncated || unresolved;
  const queue: Queued[] = commands.map((command) => ({ command, level: 1 }));
  for (const next of queue) {
    const lex = lexSegmentsBounded(next.command);
    const stopped = walkSegments(lex.segments, budget, into);
    into.truncated = into.truncated || lex.bodyUnresolved;
    if (lex.truncated || stopped) {
      into.truncated = true;
      return;
    }
    into.truncated =
      queueDeeper(queue, lex.bodyCommands, next.level) || into.truncated;
  }
}

/** Queue the commands one level below `level`; true when that is past the
 *  depth cap. */
function queueDeeper(
  queue: Queued[],
  commands: string[],
  level: number,
): boolean {
  if (commands.length === 0) return false;
  if (level >= MAX_BODY_DEPTH) return true;
  for (const command of commands) queue.push({ command, level: level + 1 });
  return false;
}
