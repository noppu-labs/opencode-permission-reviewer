import { commandName, isOptionWord } from "./brake-arguments.ts";
import {
  analyzeFindExpression,
  expressionDeletes,
  type FindActions,
} from "./brake-find-exec.ts";
import { targetsRoot } from "./brake-root-target.ts";
import { elementAt } from "./element-at.ts";
import type { AnalysisBudget } from "./shell-lexer.ts";
import { type ShellToken, sliceToken } from "./shell-token.ts";

/** The letters of the flags find accepts before its paths, alone or
 *  clustered (`-H -L -P -E -X -d -s -x`, e.g. `-dx`). A cluster may end in
 *  `f`, which takes a path (`-D` and `-O<level>` are handled apart). */
const LEADING_LETTERS = new Set(["E", "H", "L", "P", "X", "d", "s", "x"]);

/** Non-option words that start the expression and end the paths. */
const EXPRESSION_STARTS = new Set(["!", "("]);

/** A find command split into its search paths and its expression, with the
 *  commands its exec actions run. */
export interface FindCommand extends FindActions {
  paths: readonly ShellToken[];
}

/** Splits a find command and walks its exec actions under the shared
 *  `budget`, charged per argv token when the find is `nested` in another
 *  find's exec action; `undefined` for any other command. */
export function analyzeFind(
  command: readonly ShellToken[],
  budget: AnalysisBudget,
  nested: boolean,
): FindCommand | undefined {
  if (commandName(command) !== "find") return undefined;
  const { paths, expression } = splitFind(command);
  return { paths, ...analyzeFindExpression(expression, budget, nested) };
}

/**
 * `find / … -delete` and `find / … -exec rm -rf {} …` reach root through the
 * find expression rather than through a literal `rm` operand, so the rm lexer
 * does not see them. Detect them directly: when any search path resolves
 * to `/` and the expression deletes its results, the destruction is unmistakable.
 */
export function isRootFind(find: FindCommand): boolean {
  return find.paths.some(targetsRoot) && expressionDeletes(find);
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

/** A word made of leading letters; `file` when it ends in `f`, and `glued`
 *  the index where a path value starts inside the word (or -1 when the value
 *  is the next word). */
interface LeadingCluster {
  file: boolean;
  glued: number;
}

/** Splits a find command line into its search paths and its expression. The
 *  paths are the `-f` values plus every word from the first operand up to the
 *  first word that starts the expression. When an expression primary such as
 *  `-maxdepth` comes first, find rejects the command line: only the first
 *  operand is still checked as a path, and the expression starts at that
 *  primary. */
function splitFind(command: readonly ShellToken[]): FindParts {
  const { next, primary, paths } = skipLeadingOptions(command);
  const operands =
    primary === undefined
      ? scanPaths(command, next)
      : command.slice(next, next + 1);
  paths.push(...operands);
  return {
    paths,
    expression: command.slice(primary ?? next + operands.length),
  };
}

/** The words from `start` up to the first one that starts the expression. */
function scanPaths(
  command: readonly ShellToken[],
  start: number,
): readonly ShellToken[] {
  let end = start;
  while (
    end < command.length &&
    !startsExpression(elementAt(command, end, "command").value)
  )
    end += 1;
  return command.slice(start, end);
}

/** Skips the options that precede the paths; `--` ends them. */
function skipLeadingOptions(command: readonly ShellToken[]): LeadingOptions {
  const leading: LeadingOptions = { next: 1, primary: undefined, paths: [] };
  while (leading.next < command.length) {
    const word = elementAt(command, leading.next, "command");
    if (word.value === "--") {
      leading.next += 1;
      break;
    }
    if (!isOptionWord(word.value)) break;
    skipLeadingOption(command, leading, word);
  }
  return leading;
}

/** `-D` takes a value; a cluster ending in `f` takes a path, collected as
 *  long as no expression primary came first; any other option is a primary. */
function skipLeadingOption(
  command: readonly ShellToken[],
  leading: LeadingOptions,
  word: ShellToken,
): void {
  const cluster = leadingCluster(word.value);
  if (word.value === "-D") leading.next += 1;
  else if (cluster?.file && leading.primary === undefined)
    collectFilePath(command, leading, word, cluster);
  else if (cluster === undefined && !word.value.startsWith("-O"))
    leading.primary ??= leading.next;
  leading.next += 1;
}

/** Collects a `-f` value: the rest of the word when glued, else the next
 *  word. The glued value keeps its quote spans for the root checks. */
function collectFilePath(
  command: readonly ShellToken[],
  leading: LeadingOptions,
  word: ShellToken,
  cluster: LeadingCluster,
): void {
  if (cluster.glued >= 0) {
    leading.paths.push(sliceToken(word, cluster.glued));
    return;
  }
  const path = command[leading.next + 1];
  if (path !== undefined) leading.paths.push(path);
  leading.next += 1;
}

/** Reads a word as a cluster of leading letters, optionally ending in `f`
 *  with a glued path value starting at `/`; `undefined` for any other word. */
function leadingCluster(value: string): LeadingCluster | undefined {
  let index = 1;
  while (index < value.length && LEADING_LETTERS.has(value.charAt(index)))
    index += 1;
  if (index === value.length) return { file: false, glued: -1 };
  if (value.charAt(index) !== "f") return undefined;
  if (index + 1 === value.length) return { file: true, glued: -1 };
  if (value.charAt(index + 1) !== "/") return undefined;
  return { file: true, glued: index + 1 };
}

function startsExpression(value: string): boolean {
  return isOptionWord(value) || EXPRESSION_STARTS.has(value);
}
