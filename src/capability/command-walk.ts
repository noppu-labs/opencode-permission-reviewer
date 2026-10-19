// Walking lexed segments into effective commands and redirections, and walking the commands that heredoc bodies run after them.

import { elementAt } from "../element-at.ts";
import { analyzeEffectiveCommands } from "../shell-effective-commands.ts";
import { type AnalysisBudget, lexSegmentsBounded } from "../shell-lexer.ts";
import type { ShellSegment, ShellToken } from "../shell-token.ts";
import type { Redirection } from "./capability-types.ts";
import { type BodyCommands, MAX_BODY_DEPTH } from "./heredoc-body-commands.ts";

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
 * its own, after the command's own. The budget's `bodies` holds those of the
 * command strings the walks so far re-lexed. A command's lexed segments may
 * hold heredocs of their own (in a double-quoted substitution or a command
 * string), whose commands run one level deeper; past `MAX_BODY_DEPTH`
 * levels, or when a body has no end to read, the analysis is incomplete. A
 * limit that stops a walk stops the rest, which shares the one budget.
 */
export function walkBodyCommands(
  commands: string[],
  unresolved: boolean,
  budget: AnalysisBudget,
  into: Walked,
): void {
  const strings = takeBodies(budget);
  into.truncated = into.truncated || unresolved || strings.unresolved;
  const queue: Queued[] = [...commands, ...strings.commands].map((command) => ({
    command,
    level: 1,
  }));
  for (const next of queue) {
    const lex = lexSegmentsBounded(next.command);
    const stopped = walkSegments(lex.segments, budget, into);
    const deeper = takeBodies(budget);
    into.truncated = into.truncated || lex.bodyUnresolved || deeper.unresolved;
    if (lex.truncated || stopped) {
      into.truncated = true;
      return;
    }
    const nested = [...lex.bodyCommands, ...deeper.commands];
    into.truncated = queueDeeper(queue, nested, next.level) || into.truncated;
  }
}

/** The commands the budget's `bodies` holds, which it then holds no more. */
function takeBodies(budget: AnalysisBudget): BodyCommands {
  const { bodies } = budget;
  if (bodies === undefined) return { commands: [], unresolved: false };
  const taken = {
    commands: bodies.commands.splice(0),
    unresolved: bodies.unresolved,
  };
  bodies.unresolved = false;
  return taken;
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
