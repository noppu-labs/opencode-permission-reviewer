// One lexed reading of a command: every segment with its resolved effective commands, computed once per request and shared by every detector.

import { joinExecCommands } from "./brake-find-exec.ts";
import type { FindCommand } from "./brake-find-root.ts";
import { analyzeFinds } from "./brake-find-walk.ts";
import type { Redirection } from "./capability/capability-types.ts";
import {
  type BodyCommands,
  keepBodyCommands,
} from "./capability/heredoc-body-commands.ts";
import { keepBodyScripts } from "./capability/heredoc-scripts.ts";
import {
  analyzeSegmentRedirections,
  type SegmentRedirectionsAnalysis,
} from "./shell-effective-commands.ts";
import type { HeredocReading, ShellQuoting } from "./shell-lex-state.ts";
import {
  type AnalysisBudget,
  lexSegmentsBounded,
  newAnalysisBudget,
} from "./shell-lexer.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";

/** One segment with its resolved effective commands, computed once per
 *  request and shared by every detector. */
export interface AnalyzedSegment
  extends Pick<SegmentRedirectionsAnalysis, "segmentRedirections"> {
  segment: ShellSegment;
  effective: ShellToken[][];
  redirections: Redirection[][];
  finds: FindCommand[];
}

/** Lexes the command and resolves every segment's effective commands under
 *  one shared budget, or returns `undefined` when any limit is hit. The
 *  commands that heredoc bodies in its substitutions and in the command
 *  strings it re-lexes run go to `bodies`, when given. */
export function analyzeSegments(
  command: string,
  reading: HeredocReading,
  quoting: ShellQuoting,
  bodies: BodyCommands | undefined,
): AnalyzedSegment[] | undefined {
  const lex = lexSegmentsBounded(command, reading, quoting);
  keepBodyCommands(bodies, lex.bodyCommands, lex.bodyUnresolved);
  keepBodyScripts(bodies, lex.scripts);
  if (lex.truncated) return undefined;
  const budget = newAnalysisBudget(reading, quoting, bodies);
  const analyzed: AnalyzedSegment[] = [];
  for (const segment of lex.segments) {
    const analysis = analyzeSegment(segment, budget);
    if (analysis === undefined) return undefined;
    analyzed.push(analysis);
  }
  return analyzed;
}

/** Resolves one segment and the exec actions of its find commands, or
 *  returns `undefined` when any of those walks hits a limit. The commands
 *  the exec actions run join the segment's effective commands, so every
 *  detector judges them like the segment's own. */
function analyzeSegment(
  segment: ShellSegment,
  budget: AnalysisBudget,
): AnalyzedSegment | undefined {
  const analysis = analyzeSegmentRedirections(segment, budget);
  if (analysis.truncated) return undefined;
  const finds = analyzeFinds(analysis.commands, budget);
  if (finds === undefined) return undefined;
  const all = joinExecCommands([analysis, ...finds.map(({ exec }) => exec)]);
  return {
    segment,
    effective: all.commands,
    redirections: all.redirections,
    segmentRedirections: all.segmentRedirections,
    finds,
  };
}
