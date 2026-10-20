// What the effective-command walk collects, and the state of each level it walks.

import type { EffectiveCommandsAnalysis } from "./shell-effective-commands.ts";
import type { AnalysisBudget } from "./shell-lexer.ts";
import type { ShellRedirection } from "./shell-redirections.ts";

/** Where every level of one walk collects its effective commands, the
 *  redirections each level's segment carries itself, and the redirections of
 *  each `ssh` that has no remote command: it yields no effective command,
 *  and the login shell on the far side reads its stdin. */
export interface WalkSink extends EffectiveCommandsAnalysis {
  budget: AnalysisBudget;
  segmentRedirections: ShellRedirection[];
  bareSsh: ShellRedirection[][];
  /** The redirections of each shell run with `-c` and `-s`: after its
   *  command string it reads a script from stdin. */
  stdinShells: ShellRedirection[][];
}

/** One level of the walk: the redirections its commands carry, inherited
 *  ones first, and its command-string re-entry depth. */
export interface WalkLevel {
  sink: WalkSink;
  redirections: ShellRedirection[];
  depth: number;
}
