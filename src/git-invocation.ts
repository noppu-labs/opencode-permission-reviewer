// Git invocations: finds the local `git` command in a segment, its subcommand and its positional operands.

import { basename } from "node:path";
import { elementAt } from "./element-at.ts";
import { localExecutableCommand } from "./evidence/local-command.ts";
import { UNRESOLVED_EXPANSION } from "./git-execution-directory.ts";
import { invariant } from "./invariant.ts";

/** Subcommands whose first positional names (or implies) a remote. */
const GIT_REMOTE_COMMANDS = new Set([
  "push",
  "fetch",
  "pull",
  "ls-remote",
  "remote",
]);

function gitSubcommand(
  tokens: string[],
  gitIndex: number,
): { command?: string; index: number } {
  let index = gitIndex + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    invariant(token !== undefined, "tokens[index] is in bounds");
    if (
      token === "-C" ||
      token === "-c" ||
      token === "--git-dir" ||
      token === "--work-tree"
    ) {
      index += 2;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    return { command: token, index };
  }
  return { index };
}

export function positionalAfter(tokens: string[], index: number): string[] {
  const values: string[] = [];
  let afterSeparator = false;
  for (const token of tokens.slice(index + 1)) {
    if (token === "--") {
      afterSeparator = true;
      continue;
    }
    if (!afterSeparator && token.startsWith("-")) continue;
    values.push(token);
  }
  return values;
}

const PLANNED_SUBCOMMANDS: string[] = [
  "add",
  "commit",
  "checkout",
  "restore",
  "rm",
  "merge",
  "rebase",
  "stash",
  ...GIT_REMOTE_COMMANDS,
];

/** A planned Git invocation in one segment: the local `git` command's
 *  tokens and prefix, and its planned subcommand. */
export function plannedInvocation(
  segmentTokens: string[],
):
  | { tokens: string[]; prefix: string[]; subcommand: string; index: number }
  | undefined {
  const local = localExecutableCommand(segmentTokens);
  if (!local || basename(local.tokens[0] ?? "") !== "git") return undefined;
  const { command: subcommand, index } = gitSubcommand(local.tokens, 0);
  if (!subcommand || !PLANNED_SUBCOMMANDS.includes(subcommand))
    return undefined;
  return { tokens: local.tokens, prefix: local.prefix, subcommand, index };
}

const REBASE_VALUE_OPTIONS = [
  "--onto",
  "--exec",
  "-x",
  "--strategy",
  "-s",
  "--strategy-option",
  "-X",
];

/** The single literal base of a rebase, when the range has one. */
export function rebaseBase(
  tokens: string[],
  index: number,
): string | undefined {
  const args = tokens.slice(index + 1);
  const bases: string[] = [];
  for (let cursor = 0; cursor < args.length; cursor++) {
    const arg = elementAt(args, cursor, "args");
    if (REBASE_VALUE_OPTIONS.includes(arg)) cursor++;
    else if (!arg.startsWith("-")) bases.push(arg);
  }
  const [base] = bases;
  if (
    !args.includes("--root") &&
    bases.length === 1 &&
    base !== undefined &&
    !UNRESOLVED_EXPANSION.test(base)
  )
    return base;
  return undefined;
}
