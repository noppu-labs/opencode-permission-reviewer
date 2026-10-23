// What the effective-command walk collects, and the state of each level it walks.

import type { EffectiveCommandsAnalysis } from "../shell/shell-effective-commands.ts";
import type { AnalysisBudget } from "../shell/shell-lexer.ts";
import type { ShellRedirection } from "../shell/shell-redirections.ts";
import type { ShellToken } from "../shell/shell-token.ts";

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

/** One way of reading env's options: the previous release's value options,
 *  the current ones as written, or the current ones with each abbreviated
 *  long option written in full. */
export type EnvOptionsTable = "previous" | "exact" | "spelled";

/** Which tables a level reads env's options with: `both` for all of them
 *  until they first find different commands, then each group of tables
 *  that agree alone. */
export type EnvOptionsReading = "both" | readonly EnvOptionsTable[];

/** One level of the walk: the redirections its commands carry, inherited
 *  ones first, its command-string re-entry depth, whether it is inside an
 *  ssh remote command, and how it reads env's options. */
export interface WalkLevel {
  sink: WalkSink;
  redirections: ShellRedirection[];
  depth: number;
  remote: boolean;
  reading: EnvOptionsReading;
}
