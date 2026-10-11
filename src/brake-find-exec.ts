import { commandName } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import { isRootRm } from "./brake-root-rm.ts";
import { analyzeEffectiveCommands } from "./shell-effective-commands.ts";
import type { AnalysisBudget } from "./shell-lexer.ts";
import type { ShellToken } from "./shell-token.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** The commands a find expression's exec actions run, with their wrappers
 *  peeled like those of any shell command. `truncated` is true when a walk
 *  hit a limit of the request's analysis budget. */
export interface ExecCommands {
  commands: ShellToken[][];
  truncated: boolean;
}

export function expressionDeletes(
  expression: readonly ShellToken[],
  exec: readonly ShellToken[][],
): boolean {
  return (
    expression.some((token) => token.value === "-delete") ||
    exec.some(isRecursiveRm)
  );
}

/** Whether an exec action runs an rm that the rm root rule blocks, whatever
 *  paths find searches. */
export function execRemovesRoot(exec: readonly ShellToken[][]): boolean {
  return exec.some(isRootRm);
}

/** Walks every exec action's argv under the shared `budget`. */
export function analyzeExecCommands(
  expression: readonly ShellToken[],
  budget: AnalysisBudget,
): ExecCommands {
  const runs = expression.flatMap((token, index) =>
    EXEC_ACTIONS.has(token.value)
      ? [actionCommands(expression.slice(index + 1), budget)]
      : [],
  );
  return {
    commands: runs.flatMap((run) => run.commands),
    truncated: runs.some((run) => run.truncated),
  };
}

/** The first non-placeholder word after `-exec` starts the command, and its
 *  argv ends at the `;` or the `+` that follows `{}`. */
function actionCommands(
  words: readonly ShellToken[],
  budget: AnalysisBudget,
): ExecCommands {
  const start = words.findIndex(
    (word) => word.value !== "{" && word.value !== "}",
  );
  if (start === -1) return { commands: [], truncated: false };
  return analyzeEffectiveCommands(
    { tokens: [...execArgv(words, start)] },
    budget,
  );
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
