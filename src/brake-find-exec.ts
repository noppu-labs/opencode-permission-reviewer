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

/** The first non-placeholder word after `-exec` is the executable; an `rm`
 *  there is judged by the same flag rule as a top-level `rm`. */
function execRunsDestructiveRm(words: readonly ShellToken[]): boolean {
  const start = words.findIndex(
    (word) => word.value !== "{" && word.value !== "}",
  );
  if (start === -1) return false;
  const executable = words.slice(start);
  if (commandName(executable) !== "rm") return false;
  return hasRmFlags(executable).recursive;
}
