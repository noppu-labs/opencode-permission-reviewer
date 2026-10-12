import { commandName } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import {
  analyzeSegmentRedirections,
  type SegmentRedirectionsAnalysis,
} from "./shell-effective-commands.ts";
import type { AnalysisBudget } from "./shell-lexer.ts";
import type { ShellToken } from "./shell-token.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** The commands a find expression's exec actions run, with their wrappers
 *  peeled like those of any shell command. `truncated` is true when a walk
 *  hit a limit of the request's analysis budget. */
export type ExecCommands = SegmentRedirectionsAnalysis;

export function expressionDeletes(
  expression: readonly ShellToken[],
  exec: readonly ShellToken[][],
): boolean {
  return (
    expression.some((token) => token.value === "-delete") ||
    exec.some(isRecursiveRm)
  );
}

/** Walks every exec action's argv under the shared `budget`. When `charged`,
 *  each walk first costs the budget one command per argv token. */
export function analyzeExecCommands(
  expression: readonly ShellToken[],
  budget: AnalysisBudget,
  charged: boolean,
): ExecCommands {
  const runs = expression.flatMap((token, index) =>
    EXEC_ACTIONS.has(token.value)
      ? [actionCommands(expression.slice(index + 1), budget, charged)]
      : [],
  );
  return joinExecCommands(runs);
}

/** The walks of `runs` as one, in order. */
export function joinExecCommands(runs: readonly ExecCommands[]): ExecCommands {
  return {
    commands: runs.flatMap((run) => run.commands),
    redirections: runs.flatMap((run) => run.redirections),
    segmentRedirections: runs.flatMap((run) => run.segmentRedirections),
    truncated: runs.some((run) => run.truncated),
  };
}

/** The first non-placeholder word after `-exec` starts the command, and its
 *  argv ends at the `;` or the `+` that follows `{}`. */
function actionCommands(
  words: readonly ShellToken[],
  budget: AnalysisBudget,
  charged: boolean,
): ExecCommands {
  const start = words.findIndex(
    (word) => word.value !== "{" && word.value !== "}",
  );
  if (start === -1) return noCommands(false);
  const argv = execArgv(words, start);
  if (charged && !chargeArgv(argv, budget)) return noCommands(true);
  return analyzeSegmentRedirections({ tokens: [...argv] }, budget);
}

/** Charges one command per argv token, at least one, and reports whether
 *  any budget is left for the walk. */
function chargeArgv(
  argv: readonly ShellToken[],
  budget: AnalysisBudget,
): boolean {
  budget.remainingCommands -= Math.max(1, argv.length);
  return budget.remainingCommands > 0;
}

function noCommands(truncated: boolean): ExecCommands {
  return { commands: [], redirections: [], segmentRedirections: [], truncated };
}

/** An `rm` that find runs is destructive when it is recursive: find hands it
 *  the root's children. */
function isRecursiveRm(command: readonly ShellToken[]): boolean {
  return commandName(command) === "rm" && hasRmFlags(command).recursive;
}

function execArgv(
  words: readonly ShellToken[],
  start: number,
): readonly ShellToken[] {
  const end = words.findIndex(
    (word, index) =>
      index > start &&
      (word.value === ";" ||
        (word.value === "+" && words[index - 1]?.value === "{}")),
  );
  return words.slice(start, end === -1 ? undefined : end);
}
