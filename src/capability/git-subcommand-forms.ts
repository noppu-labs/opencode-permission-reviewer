// The git subcommand of a command and whether that invocation is one of the subcommand's mutating forms.

import { elementAt } from "../element-at.ts";
import type { ShellToken } from "../shell-token.ts";
import {
  BRANCH_LIST_OPTIONS,
  CONFIG_READ_OPTIONS,
  GIT_MUTATION_SUBCOMMANDS,
  TAG_LIST_OPTIONS,
} from "./bash-command-tables.ts";

/** Resolve a git subcommand from the token stream, skipping global git flags
 *  (`-C <path>`, `-c <cfg>`, `--git-dir`, …) so `git -C /repo push` still
 *  detects the `push` mutation. Mirrors `gitSubcommand()` in
 *  `src/git-command-plan.ts`. */
export function gitSubcommandOf(cmd: ShellToken[]): {
  sub?: string;
  index?: number;
} {
  let index = 1;
  while (index < cmd.length) {
    const value = elementAt(cmd, index, "cmd").value;
    if (
      value === "-C" ||
      value === "-c" ||
      value === "--git-dir" ||
      value === "--work-tree" ||
      value === "--namespace" ||
      value === "--exec-path" ||
      value === "--super-prefix"
    ) {
      index += 2;
      continue;
    }
    if (value.startsWith("-") && value.length > 1) {
      index += 1;
      continue;
    }
    return { sub: value, index };
  }
  return {};
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
