// Git command planning: parses the reviewed command into the Git actions, targets and remotes it would touch.

import { basename, resolve } from "node:path";
import { elementAt } from "./element-at.ts";
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
    const token = elementAt(tokens, cursor, "tokens");
    if (token === "--") {
      afterSeparator = true;
    } else if (!afterSeparator && token.startsWith("-") && token.length > 1) {
      const option = networkOption(tokens, cursor, subcommand, valueOpts);
      cursor = option.last;
      repoOverride = option.repoOverride ?? repoOverride;
    } else {
      operand ??= token;
    }
  }
  return repoOverride === undefined ? { operand } : { repoOverride };
}

/** One option of a network subcommand at `cursor`: the index of its last
 *  token (its separate value, if it takes one) and the `--repo` override it
 *  sets, if any. */
function networkOption(
  tokens: string[],
  cursor: number,
  subcommand: string,
  valueOpts: Set<string>,
): { last: number; repoOverride?: string } {
  const token = elementAt(tokens, cursor, "tokens");
  if (token === "--repo" && cursor + 1 < tokens.length)
    return {
      last: cursor + 1,
      repoOverride: elementAt(tokens, cursor + 1, "tokens"),
    };
  if (subcommand === "push" && token.startsWith("--repo="))
    return { last: cursor, repoOverride: token.slice("--repo=".length) };
  return { last: valueOpts.has(token) ? cursor + 1 : cursor };
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

const UNRESOLVED_EXPANSION = /[$`*?{}<>]/;

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

const REBASE_VALUE_OPTIONS = [
  "--onto",
  "--exec",
  "-x",
  "--strategy",
  "-s",
  "--strategy-option",
  "-X",
];

const MAX_REMOTE_CANDIDATES = 8;
const MAX_DEFAULT_REMOTES = 4;

/** A planned Git invocation in one segment: the local `git` command's
 *  tokens and prefix, and its planned subcommand. */
function plannedInvocation(
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

/** The single literal base of a rebase, when the range has one. */
function rebaseBase(tokens: string[], index: number): string | undefined {
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

/** Remote operands a network subcommand names, or the default-remote
 *  annotation it needs when it names none. */
function networkTargets(
  tokens: string[],
  index: number,
  subcommand: string,
): { candidates: string[]; defaultRemote?: string } {
  const { operand, repoOverride } = networkOperand(tokens, index, subcommand);
  const candidates: string[] = [];
  if (repoOverride !== undefined) candidates.push(repoOverride);
  if (operand !== undefined) candidates.push(operand);
  if (candidates.length > 0) return { candidates };
  // --all fetches every configured remote, not just the default.
  const all =
    (subcommand === "fetch" || subcommand === "pull") &&
    tokens.includes("--all");
  return {
    candidates,
    defaultRemote: all ? `${subcommand} --all` : subcommand,
  };
}

/** Remote names and URLs a `git remote` verb operates on, or the
 *  default-remote annotation `remote update` needs. */
function remoteVerbTargets(
  tokens: string[],
  index: number,
): { candidates: string[]; defaultRemote?: string } {
  const [verb, name, url] = positionalAfter(tokens, index);
  // `remote update` fetches every configured remote (or the group's
  // members) when no group operand is given.
  if (verb === "update")
    return name === undefined
      ? { candidates: [], defaultRemote: "remote update --all" }
      : { candidates: [] };
  if (verb === undefined || !REMOTE_VERBS_WITH_NAME.has(verb))
    return { candidates: [] };
  const candidates = name === undefined ? [] : [name];
  // set-url rewrites where the remote points: the new URL is a
  // destination fact, not just a name.
  if (verb === "set-url" && url !== undefined) candidates.push(url);
  return { candidates };
}

function recordRemoteTargets(
  result: PlannedGitActions,
  targets: { candidates: string[]; defaultRemote?: string },
): void {
  for (const candidate of targets.candidates) {
    if (result.remoteCandidates.length < MAX_REMOTE_CANDIDATES)
      result.remoteCandidates.push(candidate);
  }
  if (
    targets.defaultRemote !== undefined &&
    result.needsDefaultRemote.length < MAX_DEFAULT_REMOTES
  )
    result.needsDefaultRemote.push(targets.defaultRemote);
}

function recordSubcommand(
  result: PlannedGitActions,
  tokens: string[],
  index: number,
  subcommand: string,
): void {
  switch (subcommand) {
    case "rebase": {
      const base = rebaseBase(tokens, index);
      if (base !== undefined) result.rewriteBases.push(base);
      break;
    }
    case "commit":
      result.commit = true;
      break;
    case "add":
      result.plannedAdd.push(...positionalAfter(tokens, index));
      break;
    case "rm":
      result.removeTargets.push(...positionalAfter(tokens, index));
      break;
    case "checkout":
    case "restore": {
      const separator = tokens.indexOf("--", index + 1);
      if (separator >= 0)
        result.discardTargets.push(...tokens.slice(separator + 1));
      break;
    }
    case "push":
    case "fetch":
    case "pull":
    case "ls-remote":
      recordRemoteTargets(result, networkTargets(tokens, index, subcommand));
      break;
    case "remote":
      recordRemoteTargets(result, remoteVerbTargets(tokens, index));
      break;
  }
}

function settleExecutionDirectory(
  result: PlannedGitActions,
  executionDirectories: Set<string>,
  directoryReasons: Set<string>,
): void {
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
    const invocation = plannedInvocation(segment.tokens);
    if (invocation === undefined) continue;
    const { tokens, prefix, subcommand, index } = invocation;
    const execution = gitExecutionDirectory(
      tokens,
      0,
      index,
      segment.directory,
      prefix,
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
    recordSubcommand(result, tokens, index, subcommand);
  }
  settleExecutionDirectory(result, executionDirectories, directoryReasons);
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
