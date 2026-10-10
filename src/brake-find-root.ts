import { commandName, isOptionWord } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import { targetsRoot } from "./brake-root-target.ts";
import { elementAt } from "./element-at.ts";
import type { ShellToken } from "./shell-token.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * `find / … -delete` and `find / … -exec rm -rf {} …` reach root through the
 * find expression rather than through a literal `rm` operand, so the rm lexer
 * does not see them. Detect them directly: when the search root resolves
 * to `/` and the expression deletes its results, the destruction is unmistakable.
 */
export function isRootFind(command: readonly ShellToken[]): boolean {
  if (commandName(command) !== "find") return false;
  const rootIndex = searchRootIndex(command);
  if (rootIndex === undefined) return false;
  return (
    targetsRoot(elementAt(command, rootIndex, "command")) &&
    expressionDeletes(command.slice(rootIndex + 1))
  );
}

/** The search root is the first non-flag operand; everything after it
 *  belongs to the expression. Flags that take a value (e.g. `-maxdepth`)
 *  are not modelled here, so `find -maxdepth 1 / …` is a false negative
 *  (rare and safe) — we never falsely trip. */
function searchRootIndex(command: readonly ShellToken[]): number | undefined {
  for (let index = 1; index < command.length; index += 1) {
    const value = elementAt(command, index, "command").value;
    if (value === "-D") index += 1;
    else if (!isOptionWord(value)) return index;
  }
  return undefined;
}

function expressionDeletes(expression: readonly ShellToken[]): boolean {
  return expression.some(
    (token, index) =>
      token.value === "-delete" ||
      (EXEC_ACTIONS.has(token.value) &&
        execRunsDestructiveRm(expression.slice(index + 1))),
  );
}

/** First non-placeholder word after -exec is the executable; if it is `rm`
 *  with recursive+force flags, find destroys its matches. */
function execRunsDestructiveRm(words: readonly ShellToken[]): boolean {
  const start = words.findIndex(
    (word) => word.value !== "{" && word.value !== "}",
  );
  if (start === -1) return false;
  const executable = words.slice(start);
  if (commandName(executable) !== "rm") return false;
  const { recursive, force } = hasRmFlags(executable);
  return recursive && force;
}
