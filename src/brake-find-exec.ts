import { commandName } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import { effectiveCommands } from "./shell-effective-commands.ts";
import type { ShellToken } from "./shell-token.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

export function expressionDeletes(expression: readonly ShellToken[]): boolean {
  return (
    expression.some((token) => token.value === "-delete") ||
    execCommands(expression).some(isRecursiveRm)
  );
}

/** The commands the exec actions run, with their wrappers peeled like those
 *  of any shell command. */
function execCommands(expression: readonly ShellToken[]): ShellToken[][] {
  return expression.flatMap((token, index) =>
    EXEC_ACTIONS.has(token.value)
      ? actionCommands(expression.slice(index + 1))
      : [],
  );
}

/** The first non-placeholder word after `-exec` starts the command, and its
 *  argv ends at the `;` or the `+` that follows `{}`. */
function actionCommands(words: readonly ShellToken[]): ShellToken[][] {
  const start = words.findIndex(
    (word) => word.value !== "{" && word.value !== "}",
  );
  if (start === -1) return [];
  return effectiveCommands({ tokens: [...execArgv(words, start)] });
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
