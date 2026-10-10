// Git command planning: parses the reviewed command into the Git actions, targets and remotes it would touch.

import {
  gitExecutionDirectory,
  recordExecutionDirectory,
  settledExecutionDirectory,
} from "./git-execution-directory.ts";
import {
  plannedInvocation,
  positionalAfter,
  rebaseBase,
} from "./git-invocation.ts";
import {
  networkTargets,
  recordRemoteTargets,
  remoteVerbTargets,
} from "./git-remote-operands.ts";
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
      recordRemoteTargets(
        result,
        remoteVerbTargets(positionalAfter(tokens, index)),
      );
      break;
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
    recordExecutionDirectory(
      gitExecutionDirectory(tokens, 0, index, segment.directory, prefix),
      segment.directoryReason,
      executionDirectories,
      directoryReasons,
    );
    result.relevant = true;
    result.commands.push(subcommand);
    recordSubcommand(result, tokens, index, subcommand);
  }
  return Object.assign(
    result,
    settledExecutionDirectory(executionDirectories, directoryReasons),
  );
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
