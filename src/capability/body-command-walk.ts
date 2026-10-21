// Walking the commands that heredoc bodies run, after the command's own.

import { type AnalysisBudget, lexSegmentsBounded } from "../shell-lexer.ts";
import type { ScriptFeed } from "../shell-script-feeds.ts";
import { type Walked, walkSegments } from "./command-walk.ts";
import { type BodyCommands, MAX_BODY_DEPTH } from "./heredoc-body-commands.ts";
import { feedsAfterWalk, walkScripts } from "./walk-feeds.ts";

interface Queued {
  command: string;
  level: number;
  /** Run on the far side of an ssh with no remote command. */
  remote: boolean;
}

/**
 * Walk the commands that heredoc bodies run, each lexed as a command line of
 * its own, after the command's own. The budget's `bodies` holds those of the
 * command strings the walks so far re-lexed. A command's lexed segments may
 * hold heredocs of their own (in a double-quoted substitution or a command
 * string), whose commands run one level deeper; past `MAX_BODY_DEPTH`
 * levels, or when a body has no end to read, the analysis is incomplete. The
 * `feeds` are the scripts the command's shells and ssh read from a heredoc
 * or here-string, which are walked the same way, as are the scripts the
 * commands of those read in turn. A limit that stops a walk stops the rest,
 * which shares the one budget. The heredocs of each are read in the
 * `scripts` the command recorded and those every walked text adds.
 */
export function walkBodyCommands(
  commands: string[],
  unresolved: boolean,
  budget: AnalysisBudget,
  into: Walked,
  feeds: readonly ScriptFeed[] = [],
  scripts: readonly ReadonlyMap<string, readonly string[]>[] = [],
): void {
  const strings = takeBodies(budget);
  into.truncated = into.truncated || unresolved || strings.unresolved;
  const queue: Queued[] = [
    ...[...commands, ...strings.commands].map((command) => ({
      command,
      level: 1,
      remote: false,
    })),
    ...feeds.map(({ script, remote }) => ({
      command: script,
      level: 1,
      remote,
    })),
  ];
  const known = walkScripts(scripts);
  for (const next of queue) {
    const lex = lexSegmentsBounded(next.command);
    const first = {
      parts: into.parts.length,
      effective: into.effective.length,
    };
    const stopped = walkSegments(lex.segments, budget, into);
    if (next.remote) into.remote.push(...into.effective.slice(first.effective));
    const deeper = takeBodies(budget);
    into.truncated = into.truncated || lex.bodyUnresolved || deeper.unresolved;
    if (lex.truncated || stopped) {
      into.truncated = true;
      return;
    }
    const read = feedsAfterWalk(
      into,
      first.parts,
      next.command,
      lex.scripts,
      known,
    );
    const nested = [...lex.bodyCommands, ...deeper.commands];
    into.truncated = queueDeeper(queue, nested, read, next) || into.truncated;
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

/** Queue the commands and feeds one level below `from`; true when that is
 *  past the depth cap. */
function queueDeeper(
  queue: Queued[],
  commands: string[],
  feeds: readonly ScriptFeed[],
  from: Queued,
): boolean {
  if (commands.length === 0 && feeds.length === 0) return false;
  if (from.level >= MAX_BODY_DEPTH) return true;
  const level = from.level + 1;
  for (const command of commands)
    queue.push({ command, level, remote: from.remote });
  for (const { script, remote } of feeds)
    queue.push({ command: script, level, remote: from.remote || remote });
  return false;
}
