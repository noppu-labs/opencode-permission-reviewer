// Re-lexing of a command string the effective-command walk descends into, under the re-analysis budget.

import { keepStringBodies } from "../capability/heredoc/heredoc-string-bodies.ts";
import type { SubstitutionBudget } from "../shell/shell-lex-state.ts";
import type { AnalysisBudget } from "../shell/shell-lexer.ts";
import { lexSegments } from "../shell/shell-scanner.ts";
import type { ShellSegment } from "../shell/shell-token.ts";

/** Re-lex a command string for the walk to descend into. Its length is
 *  charged to the re-analysis budget first, then each substitution body as it
 *  is lexed. The commands its heredoc bodies run go to the budget's `bodies`,
 *  when it has them. `undefined` when the budget is spent. */
export function reanalysisSegments(
  text: string,
  sink: { budget: AnalysisBudget; truncated: boolean },
): ShellSegment[] | undefined {
  sink.budget.remainingReanalysisChars -= text.length;
  if (sink.budget.remainingReanalysisChars < 0) {
    sink.truncated = true;
    return;
  }
  const { bodies } = sink.budget;
  const lexBudget: SubstitutionBudget = {
    tokensRemaining: Number.POSITIVE_INFINITY,
    substitutions: "lex",
    substitutionCharsRemaining: sink.budget.remainingReanalysisChars,
    reading: sink.budget.reading ?? "default",
    quoting: sink.budget.quoting ?? "bash",
  };
  if (bodies !== undefined) lexBudget.bodies = bodies;
  keepStringBodies(bodies, text);
  const segments = lexSegments(text, lexBudget);
  sink.budget.remainingReanalysisChars = lexBudget.substitutionCharsRemaining;
  if (lexBudget.tokensRemaining <= 0) sink.truncated = true;
  return segments;
}
