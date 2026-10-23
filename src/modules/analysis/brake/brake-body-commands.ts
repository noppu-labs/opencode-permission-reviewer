// The brake's check of the commands heredoc bodies run: each is judged as a command of its own, and the bodies it holds are judged in turn.

import { MAX_BODY_DEPTH } from "../capability/heredoc/heredoc-body-commands.ts";
import { MAX_ANALYSIS_INPUT_CHARS } from "../shell/shell-lexer.ts";
import { ANALYSIS_LIMIT_REASON } from "./brake-readings.ts";

/** Judges one command at `depth`, the depth its bodies were found at. */
export type CommandJudge = (
  command: string,
  depth: number,
) => string | undefined;

/** What one request may still judge of the commands its heredoc bodies run,
 *  at every depth: how many commands, and how much of their text. */
export interface BodyBudget {
  commands: number;
  chars: number;
}

/** How many distinct body commands one request may judge. Each runs every
 *  reading of the brake, so this bounds the time a request takes. */
export const MAX_BODY_COMMANDS = 1024;

/** The budget for one request: MAX_BODY_COMMANDS commands, and twice the
 *  input cap of text. */
export function newBodyBudget(): BodyBudget {
  return {
    commands: MAX_BODY_COMMANDS,
    chars: 2 * MAX_ANALYSIS_INPUT_CHARS,
  };
}

/** The first reason `judge` gives for a command that a heredoc body runs. The
 *  commands at `depth` are the ones the bodies of depth `depth - 1` run; the
 *  top command's bodies are at depth 1. A body that is unresolved, whose
 *  commands lie past MAX_BODY_DEPTH, or whose commands overrun `budget`,
 *  gives the analysis limit. */
export function bodyCommandsReason(
  commands: readonly string[],
  unresolved: boolean,
  depth: number,
  judge: CommandJudge,
  budget: BodyBudget,
): string | undefined {
  if (commands.length === 0 && !unresolved) return undefined;
  if (unresolved || depth > MAX_BODY_DEPTH) return ANALYSIS_LIMIT_REASON;
  for (const command of new Set(commands)) {
    budget.commands -= 1;
    budget.chars -= command.length;
    if (budget.commands < 0 || budget.chars < 0) return ANALYSIS_LIMIT_REASON;
    const reason = judge(command, depth);
    if (reason !== undefined) return reason;
  }
  return undefined;
}
