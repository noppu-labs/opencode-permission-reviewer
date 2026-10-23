import { elementAt } from "../../../utils/element-at.ts";
import {
  analyzeSegmentRedirections,
  type SegmentRedirectionsAnalysis,
} from "../shell/shell-effective-commands.ts";
import type { AnalysisBudget } from "../shell/shell-lexer.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import { commandName } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** The commands a find expression's exec actions run, with their wrappers
 *  peeled like those of any shell command. `truncated` is true when a walk
 *  hit a limit of the request's analysis budget. */
export type ExecCommands = SegmentRedirectionsAnalysis;

/** A find expression split into the words outside every exec action's argv
 *  and the commands those actions run. */
export interface FindActions {
  primaries: readonly ShellToken[];
  exec: ExecCommands;
}

export function expressionDeletes({ primaries, exec }: FindActions): boolean {
  return (
    primaries.some((token) => token.value === "-delete") ||
    exec.commands.some(isRecursiveRm)
  );
}

/** Scans the expression once, left to right. When `charged`, each walk first
 *  costs `budget` one command per argv token (see `analyzeFinds`). */
export function analyzeFindExpression(
  expression: readonly ShellToken[],
  budget: AnalysisBudget,
  charged: boolean,
): FindActions {
  const primaries: ShellToken[] = [];
  const runs: ExecCommands[] = [];
  let index = 0;
  while (index < expression.length) {
    const word = elementAt(expression, index, "expression");
    if (EXEC_ACTIONS.has(word.value)) {
      const start = commandStart(expression, index + 1);
      const end = argvEnd(expression, start);
      runs.push(actionCommands(expression.slice(start, end), budget, charged));
      index = end + 1;
    } else {
      primaries.push(word);
      index += 1;
    }
  }
  return { primaries, exec: joinExecCommands(runs) };
}

/** The walks of `runs` as one, in order. */
export function joinExecCommands(runs: readonly ExecCommands[]): ExecCommands {
  return {
    commands: runs.flatMap((run) => run.commands),
    redirections: runs.flatMap((run) => run.redirections),
    segmentRedirections: runs.flatMap((run) => run.segmentRedirections),
    bareSsh: runs.flatMap((run) => run.bareSsh),
    stdinShells: runs.flatMap((run) => run.stdinShells),
    truncated: runs.some((run) => run.truncated),
  };
}

function actionCommands(
  argv: readonly ShellToken[],
  budget: AnalysisBudget,
  charged: boolean,
): ExecCommands {
  if (argv.length === 0) return noCommands(false);
  if (charged && !chargeArgv(argv, budget)) return noCommands(true);
  return analyzeSegmentRedirections({ tokens: [...argv] }, budget);
}

function chargeArgv(
  argv: readonly ShellToken[],
  budget: AnalysisBudget,
): boolean {
  budget.remainingCommands -= argv.length;
  return budget.remainingCommands > 0;
}

function noCommands(truncated: boolean): ExecCommands {
  return {
    commands: [],
    redirections: [],
    segmentRedirections: [],
    bareSsh: [],
    stdinShells: [],
    truncated,
  };
}

/** An `rm` that find runs is destructive when it is recursive: find hands it
 *  the root's children. */
function isRecursiveRm(command: readonly ShellToken[]): boolean {
  return commandName(command) === "rm" && hasRmFlags(command).recursive;
}

/** The first word after `-exec` that is not a bare `{` or `}` starts the
 *  command. */
function commandStart(words: readonly ShellToken[], from: number): number {
  let start = from;
  while (start < words.length && isBrace(words[start]?.value)) start += 1;
  return start;
}

function isBrace(value: string | undefined): boolean {
  return value === "{" || value === "}";
}

/** The argv ends at `;`, or at a `+` right after `{}`; an unterminated action
 *  takes the rest of the expression. */
function argvEnd(words: readonly ShellToken[], start: number): number {
  for (let index = start + 1; index < words.length; index += 1) {
    const value = words[index]?.value;
    if (value === ";" || (value === "+" && words[index - 1]?.value === "{}"))
      return index;
  }
  return words.length;
}
