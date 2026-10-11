import { commandName, isOptionWord } from "./brake-arguments.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import { targetsRoot } from "./brake-root-target.ts";
import { elementAt } from "./element-at.ts";
import type { ShellToken } from "./shell-token.ts";

const EXEC_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/** Options find accepts before its paths (`-D` and `-f` take a value and are
 *  handled apart; `-O<level>` is matched by prefix). */
const LEADING_OPTIONS = new Set([
  "-H",
  "-L",
  "-P",
  "-E",
  "-X",
  "-d",
  "-s",
  "-x",
]);

/** Non-option words that start the expression and end the paths. */
const EXPRESSION_STARTS = new Set(["!", "("]);

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

interface LeadingOptions {
  /** The index of the first word after the leading options and any `--`. */
  next: number;
  /** The index of the first expression primary seen before any path. */
  primary: number | undefined;
  /** The `-f` values, which are search paths too. */
  paths: ShellToken[];
}

/** Splits a find command line into its search paths and its expression. The
 *  paths are the `-f` values plus every word from the first operand up to the
 *  first word that starts the expression. When an expression primary such as
 *  `-maxdepth` comes first, find rejects the command line, and only the first
 *  operand is still checked. */
function splitFind(command: readonly ShellToken[]): FindParts {
  const { next, primary, paths } = skipLeadingOptions(command);
  if (next >= command.length)
    return { paths, expression: command.slice(primary ?? next) };
  let end = primary === undefined ? next : next + 1;
  while (
    primary === undefined &&
    end < command.length &&
    !startsExpression(elementAt(command, end, "command").value)
  )
    end += 1;
  paths.push(...command.slice(next, end));
  return { paths, expression: command.slice(end) };
}

/** Skips the options that precede the paths; `--` ends them. */
function skipLeadingOptions(command: readonly ShellToken[]): LeadingOptions {
  const leading: LeadingOptions = { next: 1, primary: undefined, paths: [] };
  while (leading.next < command.length) {
    const value = elementAt(command, leading.next, "command").value;
    if (value === "--") {
      leading.next += 1;
      break;
    }
    if (!isOptionWord(value)) break;
    skipLeadingOption(command, leading, value);
  }
  return leading;
}

/** `-D` takes a value and `-f` takes a path (collected, as long as no
 *  expression primary came first); any other non-leading option is a primary. */
function skipLeadingOption(
  command: readonly ShellToken[],
  leading: LeadingOptions,
  value: string,
): void {
  if (value === "-D") leading.next += 1;
  else if (value === "-f" && leading.primary === undefined) {
    const path = command[leading.next + 1];
    if (path !== undefined) leading.paths.push(path);
    leading.next += 1;
  } else if (!isLeadingOption(value)) leading.primary ??= leading.next;
  leading.next += 1;
}

function isLeadingOption(value: string): boolean {
  return LEADING_OPTIONS.has(value) || value.startsWith("-O");
}

function startsExpression(value: string): boolean {
  return isOptionWord(value) || EXPRESSION_STARTS.has(value);
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
