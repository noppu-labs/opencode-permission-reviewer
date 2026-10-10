// Git command planning: parses the reviewed command into the Git actions, targets and remotes it would touch.

import { basename, resolve } from "node:path";
import { localExecutableCommand } from "./evidence/local-command.ts";
import { invariant } from "./invariant.ts";
import { shellCommandSegmentsWithDirectory } from "./ssh-command-segments.ts";

export interface PlannedGitActions {
  relevant: boolean;
  commit: boolean;
  plannedAdd: string[];
  discardTargets: string[];
  removeTargets: string[];
  commands: string[];
  rewriteBases: string[];
  /** Remote operands as written (configured names, literal URLs) collected
   *  from network subcommands. Resolution to URLs happens later, inside the
   *  containment envelope. */
  remoteCandidates: string[];
  /** Network subcommands whose operand list had no explicit remote, so git
   *  will contact the branch/default-configured remote instead. */
  needsDefaultRemote: string[];
  executionDirectory?: string;
  directoryReason?: string;
}

/** Subcommands whose first positional names (or implies) a remote. */
const GIT_REMOTE_COMMANDS = new Set([
  "push",
  "fetch",
  "pull",
  "ls-remote",
  "remote",
]);

/** Verbs of `git remote` that operate on a named remote as their next
 *  positional. `update` takes an optional group, not a remote name. */
const REMOTE_VERBS_WITH_NAME = new Set([
  "prune",
  "show",
  "get-url",
  "set-url",
  "set-head",
  "rename",
  "remove",
  "rm",
]);

/** Options of the network subcommands that consume a separate value token.
 *  Without skipping the value, `git fetch --depth 1 origin` would report "1"
 *  as the remote operand and hide the real destination. Options with an
 *  OPTIONAL value (`--force-with-lease`, `--rebase`, `--signed`, …) are
 *  deliberately absent: git requires `=` for those, and skipping the next
 *  token would swallow the remote instead. */
const NETWORK_VALUE_OPTIONS: Record<string, Set<string>> = {
  push: new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]),
  fetch: new Set([
    "--depth",
    "--deepen",
    "--shallow-since",
    "--shallow-exclude",
    "-j",
    "--jobs",
    "--refmap",
    "--upload-pack",
    "-o",
    "--server-option",
    "--negotiation-tip",
    "--filter",
  ]),
  pull: new Set([
    "--depth",
    "--deepen",
    "--shallow-since",
    "--shallow-exclude",
    "-j",
    "--jobs",
    "--refmap",
    "--upload-pack",
    "-o",
    "--server-option",
    "--negotiation-tip",
    "--filter",
    "-s",
    "--strategy",
    "-X",
    "--strategy-option",
  ]),
  "ls-remote": new Set(["--sort", "--upload-pack", "-o", "--server-option"]),
  remote: new Set(),
};

/** First positional operand of a network subcommand, skipping options and
 *  their separate values. Returns the operand plus any `--repo`-style
 *  override value, which is itself a push destination. */
function networkOperand(
  tokens: string[],
  index: number,
  subcommand: string,
): { operand?: string | undefined; repoOverride?: string | undefined } {
  const valueOpts = NETWORK_VALUE_OPTIONS[subcommand] ?? new Set<string>();
  let afterSeparator = false;
  let operand: string | undefined;
  let repoOverride: string | undefined;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    invariant(token !== undefined, "tokens[cursor] is in bounds");
    if (token === "--") {
      afterSeparator = true;
      continue;
    }
    if (!afterSeparator && token.startsWith("-") && token.length > 1) {
      if (token === "--repo" && cursor + 1 < tokens.length) {
        repoOverride = tokens[++cursor];
        continue;
      }
      if (subcommand === "push" && token.startsWith("--repo=")) {
        repoOverride = token.slice("--repo=".length);
        continue;
      }
      if (valueOpts.has(token)) cursor += 1;
      continue;
    }
    operand ??= token;
  }
  return repoOverride === undefined ? { operand } : { repoOverride };
}

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

function positionalAfter(tokens: string[], index: number): string[] {
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

function gitExecutionDirectory(
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
    const token = tokens[index];
    invariant(
      token !== undefined,
      "tokens[index] is in bounds below the subcommand index",
    );
    if (
      token.startsWith("--git-dir") ||
      token.startsWith("--work-tree") ||
      token.startsWith("--config-env")
    )
      return {
        reason: "Git repository or configuration overrides are unresolved",
      };
    const config =
      token === "-c"
        ? tokens[index + 1]
        : token.startsWith("-c")
          ? token.slice(2)
          : undefined;
    if (
      config &&
      /^(?:remote\.|url\.|branch\..*\.(?:remote|pushRemote)=|core\.worktree=)/i.test(
        config,
      )
    )
      return {
        reason:
          "Git destination or worktree configuration overrides are unresolved",
      };
    let target: string | undefined;
    if (token === "-C") {
      target = tokens[index + 1];
      index += 1;
    } else if (token.startsWith("-C") && token.length > 2) {
      target = token.slice(2);
    }
    if (target === undefined) continue;
    if (/[$`*?{}<>]/.test(target))
      return { reason: "git -C contains unresolved shell expansion" };
    directory = resolve(directory, target);
  }
  return { directory };
}

export function plannedActions(
  command: string,
  directory: string,
): PlannedGitActions {
  const result: PlannedGitActions = {
    relevant: false,
    commit: false,
    plannedAdd: [],
    discardTargets: [],
    removeTargets: [],
    commands: [],
    rewriteBases: [],
    remoteCandidates: [],
    needsDefaultRemote: [],
  };
  const executionDirectories = new Set<string>();
  const directoryReasons = new Set<string>();

  for (const segment of shellCommandSegmentsWithDirectory(command, directory)) {
    const local = localExecutableCommand(segment.tokens);
    if (!local || basename(local.tokens[0] ?? "") !== "git") continue;
    const tokens = local.tokens;
    const gitIndex = 0;
    const { command: subcommand, index } = gitSubcommand(tokens, gitIndex);
    if (!subcommand) continue;
    if (
      ![
        "add",
        "commit",
        "checkout",
        "restore",
        "rm",
        "merge",
        "rebase",
        "stash",
        ...GIT_REMOTE_COMMANDS,
      ].includes(subcommand)
    )
      continue;
    const execution = gitExecutionDirectory(
      tokens,
      gitIndex,
      index,
      segment.directory,
      local.prefix,
    );
    if (execution.directory) executionDirectories.add(execution.directory);
    else
      directoryReasons.add(
        execution.reason ??
          segment.directoryReason ??
          "Git directory is unresolved",
      );
    result.relevant = true;
    result.commands.push(subcommand);
    if (subcommand === "rebase") {
      const args = tokens.slice(index + 1);
      const bases: string[] = [];
      for (let cursor = 0; cursor < args.length; cursor++) {
        const arg = args[cursor];
        invariant(arg !== undefined, "args[cursor] is in bounds");
        if (
          [
            "--onto",
            "--exec",
            "-x",
            "--strategy",
            "-s",
            "--strategy-option",
            "-X",
          ].includes(arg)
        ) {
          cursor++;
          continue;
        }
        if (!arg.startsWith("-")) {
          bases.push(arg);
        }
      }
      const [base] = bases;
      if (
        !args.includes("--root") &&
        bases.length === 1 &&
        base !== undefined &&
        !/[$`*?{}<>]/.test(base)
      )
        result.rewriteBases.push(base);
    }
    if (subcommand === "commit") result.commit = true;
    if (subcommand === "add")
      result.plannedAdd.push(...positionalAfter(tokens, index));
    if (subcommand === "rm")
      result.removeTargets.push(...positionalAfter(tokens, index));
    if (subcommand === "checkout" || subcommand === "restore") {
      const separator = tokens.indexOf("--", index + 1);
      if (separator >= 0)
        result.discardTargets.push(...tokens.slice(separator + 1));
    }
    if (
      subcommand === "push" ||
      subcommand === "fetch" ||
      subcommand === "pull" ||
      subcommand === "ls-remote"
    ) {
      const { operand, repoOverride } = networkOperand(
        tokens,
        index,
        subcommand,
      );
      const candidates: string[] = [];
      if (repoOverride !== undefined) candidates.push(repoOverride);
      if (operand !== undefined) candidates.push(operand);
      if (candidates.length > 0) {
        for (const candidate of candidates) {
          if (result.remoteCandidates.length < 8)
            result.remoteCandidates.push(candidate);
        }
      } else if (result.needsDefaultRemote.length < 4) {
        // --all fetches every configured remote, not just the default.
        const all =
          (subcommand === "fetch" || subcommand === "pull") &&
          tokens.includes("--all");
        result.needsDefaultRemote.push(
          all ? `${subcommand} --all` : subcommand,
        );
      }
    }
    if (subcommand === "remote") {
      const verbs = positionalAfter(tokens, index);
      const [verb, name, url] = verbs;
      if (verb === "update") {
        // `remote update` fetches every configured remote (or the group's
        // members) when no group operand is given.
        if (name === undefined && result.needsDefaultRemote.length < 4) {
          result.needsDefaultRemote.push("remote update --all");
        }
      } else if (verb !== undefined && REMOTE_VERBS_WITH_NAME.has(verb)) {
        if (name !== undefined && result.remoteCandidates.length < 8)
          result.remoteCandidates.push(name);
        // set-url rewrites where the remote points: the new URL is a
        // destination fact, not just a name.
        if (
          verb === "set-url" &&
          url !== undefined &&
          result.remoteCandidates.length < 8
        ) {
          result.remoteCandidates.push(url);
        }
      }
    }
  }
  const [onlyDirectory] = executionDirectories;
  if (
    executionDirectories.size === 1 &&
    directoryReasons.size === 0 &&
    onlyDirectory !== undefined
  ) {
    result.executionDirectory = onlyDirectory;
  } else if (executionDirectories.size > 1) {
    result.directoryReason =
      "compound command targets multiple Git working directories";
  } else if (directoryReasons.size > 0) {
    result.directoryReason = [...directoryReasons].join("; ");
  }
  return result;
}

export function boundedList(
  values: string[],
  max = 200,
): { values: string[]; omitted: number } {
  return {
    values: values.slice(0, max),
    omitted: Math.max(0, values.length - max),
  };
}
