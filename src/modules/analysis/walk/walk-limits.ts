// The caps that stop the effective-command walk: depth, number of commands, and the shared command budget.

import {
  type AnalysisBudget,
  MAX_EFFECTIVE_COMMANDS,
} from "../shell/shell-lexer.ts";
import type { ShellToken } from "../shell/shell-token.ts";

/** Ceiling on command-string re-entry (`sh -c`, `env -S`, watch, ssh,
 *  busybox, chroot). Deeper nesting than this is not a legitimate review
 *  shape; the walk stops descending and the unanalyzed remainder stays the
 *  model reviewer's job, keeping unbounded input from exhausting the stack. */
const MAX_WALK_DEPTH = 32;

/** Whether the walk may not take another level or command: recursion here is
 *  driven by the (untrusted) command text, so depth and expansion budget are
 *  hard stops, not tuning knobs. */
export function walkLimitReached(
  sink: { commands: ShellToken[][]; budget: AnalysisBudget },
  depth: number,
): boolean {
  return (
    depth > MAX_WALK_DEPTH ||
    sink.commands.length >= MAX_EFFECTIVE_COMMANDS ||
    sink.budget.remainingCommands <= 0
  );
}
