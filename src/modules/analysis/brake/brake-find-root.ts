import { elementAt } from "../../../utils/element-at.ts";
import type { AnalysisBudget } from "../shell/shell-lexer.ts";
import { type ShellToken, sliceToken } from "../shell/shell-token.ts";
import { commandName, isOptionWord } from "./brake-arguments.ts";
import {
  analyzeFindExpression,
  expressionDeletes,
  type FindActions,
} from "./brake-find-exec.ts";
import { targetsRoot } from "./brake-root-target.ts";

/** The letters of the flags find accepts before its paths, alone or
 *  clustered (`-H -L -P -E -X -d -s -x`, e.g. `-dx`). A cluster may end in
 *  `f`, which takes a path (`-D` and `-O<level>` are handled apart). */
const LEADING_LETTERS = new Set(["E", "H", "L", "P", "X", "d", "s", "x"]);

const EXPRESSION_STARTS = new Set(["!", "("]);

export interface FindCommand extends FindActions {
  paths: readonly ShellToken[];
}

/** `nested`: this find runs in another find's exec action, so its exec
 *  walks are charged per argv token (see `analyzeFinds`). */
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

/** The paths are the `-f` values plus the words from the first operand up to
 *  the first word that starts the expression. find rejects a primary such as
 *  `-maxdepth` before the paths, so then only the first operand is still
 *  checked as a path. */
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

/** `-D` skips its value; an `f` cluster collects its path until a primary
 *  is seen; a word that is neither a leading-letter cluster nor `-O<level>`
 *  is the first primary. */
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

/** A glued value keeps its quote spans so the live-glob check still sees
 *  which characters were quoted. */
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
