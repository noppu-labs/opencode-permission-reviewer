/*
 * Effective-command walk over the segments shell-scanner.ts produces: peels
 * wrappers and destructures command-string forms (`sh -c`, `su -c`,
 * `env -S`, `ssh host cmd`, `busybox applet`, `chroot root cmd`,
 * `timeout duration cmd`). The emergency brake, the capability parser and the
 * script evidence enrichers all consume it.
 *
 * Command-string recursion depth and the total number of resolved effective
 * commands are hard-capped, so adversarial nesting can neither exhaust the
 * stack nor expand the result without bound. The walk and its depth cap live
 * in effective-command-walk.ts; this module is its public entry point.
 */

import { type WalkSink, walk } from "./effective-command-walk.ts";
import { type AnalysisBudget, newAnalysisBudget } from "./shell-lexer.ts";
import type { ShellRedirection } from "./shell-redirections.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";

/**
 * Resolve a segment into its "effective commands" — the token lists starting
 * at each real executable, after peeling wrappers and destructuring
 * command-string forms. May yield multiple commands when a shell/su `-c` body
 * itself contains separators.
 */
export function effectiveCommands(segment: ShellSegment): ShellToken[][] {
  return analyzeEffectiveCommands(segment).commands;
}

/** Result of bounded command-string resolution. `truncated` is true when the
 *  depth or expansion budget stopped the descent, meaning `commands` is a
 *  prefix of the real structure: parts of the command were never analyzed. */
export interface EffectiveCommandsAnalysis {
  commands: ShellToken[][];
  /** Redirections removed from each effective command, in matching order. */
  redirections: ShellRedirection[][];
  truncated: boolean;
}

/** Resolve one segment into effective commands. Pass a shared `budget` to
 *  cover a whole request: without it, every segment gets a fresh ceiling and
 *  a wide input never reports truncation. */
export function analyzeEffectiveCommands(
  segment: ShellSegment,
  budget?: AnalysisBudget,
): EffectiveCommandsAnalysis {
  const sink: WalkSink = {
    commands: [],
    redirections: [],
    truncated: false,
    budget: budget ?? newAnalysisBudget(),
  };
  walk(segment.tokens, sink, [], 0);
  return {
    commands: sink.commands,
    redirections: sink.redirections,
    truncated: sink.truncated,
  };
}
