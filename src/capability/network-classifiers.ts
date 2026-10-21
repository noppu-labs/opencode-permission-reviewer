// Network, remote and git classifiers for one effective command. Each one that matches may claim the action class, so their call order decides it.

import { elementAt } from "../element-at.ts";
import type { ShellToken } from "../shell-token.ts";
import { claimClass } from "./action-class.ts";
import {
  GIT_MUTATION_SUBCOMMANDS,
  GIT_NETWORK_SUBCOMMANDS,
  NETWORK_CLIENTS,
  SSH_TOOLS,
} from "./bash-command-tables.ts";
import { destinationFromTokens } from "./bash-mutation.ts";
import type { CapabilityFacts } from "./capability-facts.ts";
import {
  gitSubcommandMutates,
  gitSubcommandOf,
} from "./git-subcommand-forms.ts";

export function classifyNetworkClient(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
): void {
  if (!NETWORK_CLIENTS.has(base)) return;
  facts.networkObserved = true;
  facts.destinations.push(...destinationFromTokens(cmd));
  claimClass(facts, "network");
}

export function classifySshTool(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
): void {
  if (!SSH_TOOLS.has(base)) return;
  facts.remoteEnabled = true;
  facts.childProcesses = true;
  // ssh with a remote command that mutates → remote mutation hint.
  classifyRemoteCommand(cmd, facts);
  claimClass(facts, "remote-operation");
}

/** A command that runs on the far side of an ssh, from its word at `from`:
 *  one that mutates is a remote mutation hint. */
export function classifyRemoteCommand(
  cmd: readonly ShellToken[],
  facts: CapabilityFacts,
  from = 0,
): void {
  for (let k = from; k < cmd.length; k += 1) {
    const { value } = elementAt(cmd, k, "cmd");
    if (GIT_MUTATION_SUBCOMMANDS.has(value) || value === "rm") {
      facts.remoteMutation = true;
      return;
    }
  }
}

export function classifyGit(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
): void {
  if (base !== "git") return;
  facts.gitObserved = true;
  const { sub, index } = gitSubcommandOf(cmd);
  if (sub === undefined) return;
  const network = GIT_NETWORK_SUBCOMMANDS.has(sub);
  if (network) facts.networkObserved = true;
  if (index !== undefined && gitSubcommandMutates(cmd, sub, index)) {
    facts.gitMutation = true;
    if (sub === "push") facts.externalWrite = true;
    else facts.workspaceWrite = true;
  } else if (network) {
    claimClass(facts, "network");
  }
}
