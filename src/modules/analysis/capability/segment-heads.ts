// Wrapper detection on the commands the effective-command walk resolves, for the wrappers it peels out of `effective`.

import type { ShellToken } from "../shell/shell-token.ts";
import type { PeeledHead } from "../walk/walk-sink.ts";
import { claimUnsetClass } from "./action-class.ts";
import {
  PERSISTENCE_WRAPPERS,
  PRIVILEGE_WRAPPERS,
  SSH_TOOLS,
} from "./bash-command-tables.ts";
import type { CapabilityFacts } from "./capability-facts.ts";
import { classifyRemoteCommand } from "./network-classifiers.ts";

/** Wrappers the walk peels (sudo, nohup, ssh, …) must be detected on the
 *  commands it resolves, because `effective` starts at the real executable
 *  after peeling. The walk reports each one at every level it re-enters, so
 *  a command string, `env -S`, `watch` or an ssh remote command counts as
 *  the same command run directly does. */
export function classifySegmentHeads(
  heads: readonly PeeledHead[],
  facts: CapabilityFacts,
): void {
  let scanned: readonly ShellToken[] | undefined;
  for (const peeled of heads) {
    classifyWrapperHead(peeled.head, facts);
    // The commands of one level come in order, so the first one inside an
    // ssh remote command already covers the words of the ones after it.
    if (peeled.remote && peeled.tokens !== scanned) {
      scanned = peeled.tokens;
      classifyRemoteCommand(peeled.tokens, facts, peeled.index);
    }
  }
}

/** The facts a wrapper head carries itself: privilege, persistence, and an
 *  ssh that makes the command a remote operation. */
export function classifyWrapperHead(
  head: string,
  facts: CapabilityFacts,
): void {
  if (PRIVILEGE_WRAPPERS.has(head)) {
    facts.privilegeEscalation = true;
    facts.childProcesses = true;
  }
  if (PERSISTENCE_WRAPPERS.has(head)) {
    facts.persistence = true;
    facts.childProcesses = true;
  }
  if (SSH_TOOLS.has(head)) {
    facts.remoteEnabled = true;
    facts.childProcesses = true;
    claimUnsetClass(facts, "remote-operation");
  }
}
