import { commandName, isOptionWord } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import { targetsRoot } from "./brake-root-target.ts";
import { elementAt } from "./element-at.ts";
import type { ShellToken } from "./shell-token.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * `find / … -delete` and `find / … -exec rm -rf {} …` reach root through the
 * find expression rather than through a literal `rm` operand, so the rm lexer
 * does not see them. Detect them directly: when any search path resolves
 * to `/` and the expression deletes its results, the destruction is unmistakable.
 */
export function isRootFind(command: readonly ShellToken[]): boolean {
  if (commandName(command) !== "find") return false;
  const { paths, expression } = splitFind(command);
  return paths.some(targetsRoot) && expressionDeletes(expression);
}

interface FindParts {
  paths: readonly ShellToken[];
  expression: readonly ShellToken[];
}

/** Splits a find command line into its search paths and its expression. The
 *  paths start at the first operand after the leading options (`-D` takes a
 *  value) and run up to the first word that starts the expression. When an
 *  expression option such as `-maxdepth` already came first, find reads no
 *  paths after it, so only that first operand is a path. */
function splitFind(command: readonly ShellToken[]): FindParts {
  const first = firstOperandIndex(command);
  if (first === undefined) return { paths: [], expression: [] };
  const expressionFirst = command
    .slice(1, first)
    .some((token) => isOptionWord(token.value) && !isGlobalOption(token.value));
  let end = first + 1;
  while (
    !expressionFirst &&
    end < command.length &&
    !startsExpression(elementAt(command, end, "command").value)
  )
    end += 1;
  return { paths: command.slice(first, end), expression: command.slice(end) };
}

function firstOperandIndex(command: readonly ShellToken[]): number | undefined {
  for (let index = 1; index < command.length; index += 1) {
    const value = elementAt(command, index, "command").value;
    if (value === "-D") index += 1;
    else if (!isOptionWord(value)) return index;
  }
  return undefined;
}

/** The options find accepts before its paths: `-H`, `-L`, `-P`, `-D` and
 *  `-O<level>`. */
function isGlobalOption(value: string): boolean {
  return (
    value === "-H" ||
    value === "-L" ||
    value === "-P" ||
    value === "-D" ||
    value.startsWith("-O")
  );
}

/** A word that starts the expression: an option word, `!`, `(`, `)` or `,`. */
function startsExpression(value: string): boolean {
  return isOptionWord(value) || ["!", "(", ")", ","].includes(value);
}

function expressionDeletes(expression: readonly ShellToken[]): boolean {
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
