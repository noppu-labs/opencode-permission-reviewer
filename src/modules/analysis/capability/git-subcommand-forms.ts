// The git subcommand of a command and whether that invocation is one of the subcommand's mutating forms.

import { gitSubcommandIndex } from "../../evidence/git/git-global-options.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import {
  BRANCH_LIST_OPTIONS,
  CONFIG_READ_OPTIONS,
  GIT_MUTATION_SUBCOMMANDS,
  TAG_LIST_OPTIONS,
} from "./bash-command-tables.ts";

/** Resolve a git subcommand from the token stream, skipping global git
 *  options and their separate values (see `src/modules/evidence/git/git-global-options.ts`), so
 *  `git -C /repo push` still detects the `push` mutation. */
export function gitSubcommandOf(cmd: ShellToken[]): {
  sub?: string;
  index?: number;
} {
  const index = gitSubcommandIndex(
    cmd.map((token) => token.value),
    0,
  );
  const sub = cmd[index]?.value;
  return sub === undefined ? {} : { sub, index };
}

/** Distinguish the common read-only forms of Git subcommands that also have
 * mutation modes. Everything else in the mutation set stays conservative. */
export function gitSubcommandMutates(
  cmd: ShellToken[],
  sub: string,
  index: number,
): boolean {
  if (!GIT_MUTATION_SUBCOMMANDS.has(sub)) return false;
  const args = cmd.slice(index + 1).map((token) => token.value);
  const positional = args.filter(
    (value) => value !== "--" && !value.startsWith("-"),
  );
  const mutates = GIT_SUBCOMMAND_FORMS.get(sub);
  return mutates === undefined ? true : mutates(args, positional);
}

function branchMutates(args: string[]): boolean {
  return (
    args.length > 0 &&
    !args.some((value) => BRANCH_LIST_OPTIONS.includes(value))
  );
}

function tagMutates(args: string[]): boolean {
  return (
    args.length > 0 && !args.some((value) => TAG_LIST_OPTIONS.includes(value))
  );
}

function remoteMutates(_args: string[], positional: string[]): boolean {
  const first = positional[0];
  return first !== undefined && !["show", "get-url"].includes(first);
}

function configMutates(args: string[], positional: string[]): boolean {
  if (args.some((value) => CONFIG_READ_OPTIONS.includes(value))) return false;
  return (
    positional.length >= 2 ||
    args.some((value) => /(?:add|set|unset|remove|rename)/.test(value))
  );
}

function worktreeMutates(_args: string[], positional: string[]): boolean {
  return !(positional.length === 0 || positional[0] === "list");
}

function notesMutates(_args: string[], positional: string[]): boolean {
  const first = positional[0];
  return !(first === undefined || ["list", "show"].includes(first));
}

function submoduleMutates(_args: string[], positional: string[]): boolean {
  const first = positional[0];
  return !(first === undefined || ["status", "summary"].includes(first));
}

function symbolicRefMutates(args: string[], positional: string[]): boolean {
  return args.includes("--delete") || positional.length >= 2;
}

/** Whether a subcommand with read-only forms mutates, given its arguments
 *  and their positional subset. Each subcommand has one entry, so no two
 *  entries can disagree about an invocation. */
const GIT_SUBCOMMAND_FORMS = new Map<
  string,
  (args: string[], positional: string[]) => boolean
>([
  ["branch", branchMutates],
  ["tag", tagMutates],
  ["remote", remoteMutates],
  ["config", configMutates],
  ["worktree", worktreeMutates],
  ["notes", notesMutates],
  ["submodule", submoduleMutates],
  ["symbolic-ref", symbolicRefMutates],
]);
