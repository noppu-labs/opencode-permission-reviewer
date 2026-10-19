// The brake's check of the commands heredoc bodies run: each is judged as a command of its own, and the bodies it holds are judged in turn.

import { ANALYSIS_LIMIT_REASON } from "./brake-readings.ts";
import { MAX_BODY_DEPTH } from "./capability/heredoc-body-commands.ts";

/** Judges one command at `depth`, the depth its bodies were found at. */
export type CommandJudge = (
  command: string,
  depth: number,
) => string | undefined;

/** The first reason `judge` gives for a command that a heredoc body runs. The
 *  commands at `depth` are the ones the bodies of depth `depth - 1` run; the
 *  top command's bodies are at depth 1. A body that is unresolved, or whose
 *  commands lie past MAX_BODY_DEPTH, gives the analysis limit. */
export function bodyCommandsReason(
  commands: readonly string[],
  unresolved: boolean,
  depth: number,
  judge: CommandJudge,
): string | undefined {
  if (commands.length === 0 && !unresolved) return undefined;
  if (unresolved || depth > MAX_BODY_DEPTH) return ANALYSIS_LIMIT_REASON;
  for (const command of new Set(commands)) {
    const reason = judge(command, depth);
    if (reason !== undefined) return reason;
  }
  return undefined;
}
