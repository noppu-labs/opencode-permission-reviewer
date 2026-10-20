// What the effective-command walk collects, and the state of each level it walks.

import type { EffectiveCommandsAnalysis } from "./shell-effective-commands.ts";
import type { AnalysisBudget } from "./shell-lexer.ts";
import type { ShellRedirection } from "./shell-redirections.ts";
import type { ShellToken } from "./shell-token.ts";

/** A command the walk resolves, wrapper or not: its basename, the words of
 *  its level and its index among them, and whether it runs inside the
 *  remote command of an ssh, mosh or autossh. */
export interface PeeledHead {
  head: string;
  tokens: readonly ShellToken[];
  index: number;
  remote: boolean;
}

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
  /** Every command each level resolves, in walk order. */
  heads?: PeeledHead[];
}

/** One level of the walk: the redirections its commands carry, inherited
 *  ones first, its command-string re-entry depth, and whether it is inside
 *  an ssh remote command. */
export interface WalkLevel {
  sink: WalkSink;
  redirections: ShellRedirection[];
  depth: number;
  remote: boolean;
}
