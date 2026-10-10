// Git execution directory: the directory a planned Git command runs in, after `cd` and its global options.

import { resolve } from "node:path";
import { elementAt } from "./element-at.ts";

export const UNRESOLVED_EXPANSION = /[$`*?{}<>]/;

export function gitExecutionDirectory(
  tokens: string[],
  gitIndex: number,
  subcommandIndex: number,
  initialDirectory: string | undefined,
  prefix: string[],
): { directory?: string; reason?: string } {
  if (!initialDirectory)
    return { reason: "working directory before Git is unresolved" };
  if (
    prefix.some((token) =>
      /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|CONFIG[^=]*)=/.test(token),
    )
  )
    return {
      reason:
        "Git repository or configuration environment overrides are unresolved",
    };
  let directory = initialDirectory;
  for (let index = gitIndex + 1; index < subcommandIndex; index += 1) {
    const step = globalOptionStep(tokens, index, directory);
    if ("reason" in step) return { reason: step.reason };
    ({ last: index, directory } = step);
  }
  return { directory };
}

/** Applies the global option at `index` (below the subcommand) to the
 *  directory Git will run in: the index of the option's last token and the
 *  resulting directory, or the reason the directory cannot be resolved. */
function globalOptionStep(
  tokens: string[],
  index: number,
  directory: string,
): { last: number; directory: string } | { reason: string } {
  const token = elementAt(tokens, index, "tokens");
  const reason = globalOptionOverrideReason(token, tokens[index + 1]);
  if (reason !== undefined) return { reason };
  const { target, last } = changeDirectoryTarget(tokens, index, token);
  if (target === undefined) return { last, directory };
  if (UNRESOLVED_EXPANSION.test(target))
    return { reason: "git -C contains unresolved shell expansion" };
  return { last, directory: resolve(directory, target) };
}

/** Why a global option makes the repository, its configuration or its
 *  destinations unresolvable, if it does. `next` is the token after it. */
function globalOptionOverrideReason(
  token: string,
  next: string | undefined,
): string | undefined {
  if (
    token.startsWith("--git-dir") ||
    token.startsWith("--work-tree") ||
    token.startsWith("--config-env")
  )
    return "Git repository or configuration overrides are unresolved";
  const config =
    token === "-c" ? next : token.startsWith("-c") ? token.slice(2) : undefined;
  if (
    config &&
    /^(?:remote\.|url\.|branch\..*\.(?:remote|pushRemote)=|core\.worktree=)/i.test(
      config,
    )
  )
    return "Git destination or worktree configuration overrides are unresolved";
  return undefined;
}

function changeDirectoryTarget(
  tokens: string[],
  index: number,
  token: string,
): { target?: string | undefined; last: number } {
  if (token === "-C") return { target: tokens[index + 1], last: index + 1 };
  if (token.startsWith("-C") && token.length > 2)
    return { target: token.slice(2), last: index };
  return { last: index };
}

/** Adds the directory one planned invocation runs in, or the reason it is
 *  unresolved: the option-level reason first, then the segment's. */
export function recordExecutionDirectory(
  execution: { directory?: string; reason?: string },
  segmentReason: string | undefined,
  executionDirectories: Set<string>,
  directoryReasons: Set<string>,
): void {
  if (execution.directory) executionDirectories.add(execution.directory);
  else
    directoryReasons.add(
      execution.reason ?? segmentReason ?? "Git directory is unresolved",
    );
}

/** The one directory every planned Git invocation runs in, or why there is
 *  none. */
export function settledExecutionDirectory(
  executionDirectories: Set<string>,
  directoryReasons: Set<string>,
): { executionDirectory?: string; directoryReason?: string } {
  const [onlyDirectory] = executionDirectories;
  if (
    executionDirectories.size === 1 &&
    directoryReasons.size === 0 &&
    onlyDirectory !== undefined
  )
    return { executionDirectory: onlyDirectory };
  if (executionDirectories.size > 1)
    return {
      directoryReason:
        "compound command targets multiple Git working directories",
    };
  if (directoryReasons.size > 0)
    return { directoryReason: [...directoryReasons].join("; ") };
  return {};
}
