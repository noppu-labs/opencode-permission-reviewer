import { commandName } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import type { ShellToken } from "./shell-token.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

export function expressionDeletes(expression: readonly ShellToken[]): boolean {
  return expression.some(
    (token, index) =>
      token.value === "-delete" ||
      (EXEC_ACTIONS.has(token.value) &&
        execRunsDestructiveRm(expression.slice(index + 1))),
  );
}

/** The first non-placeholder word after `-exec` is the executable, and its
 *  argv ends at the `;` or the `+` that follows `{}`. An `rm` there is
 *  destructive when it is recursive: find hands it the root's children. */
function execRunsDestructiveRm(words: readonly ShellToken[]): boolean {
  const start = words.findIndex(
    (word) => word.value !== "{" && word.value !== "}",
  );
  if (start === -1) return false;
  const executable = execArgv(words, start);
  if (commandName(executable) !== "rm") return false;
  return hasRmFlags(executable).recursive;
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
