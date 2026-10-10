// Wrapper detection on the original segment heads, for the wrappers the lexer peels out of `effective`.

import { shellBasename } from "../shell-lexer.ts";
import type { ShellSegment, ShellToken } from "../shell-token.ts";
import { commandStart } from "../shell-wrapper-options.ts";
import { claimUnsetClass } from "./action-class.ts";
import {
  GIT_MUTATION_SUBCOMMANDS,
  PERSISTENCE_WRAPPERS,
  PRIVILEGE_WRAPPERS,
  SSH_TOOLS,
} from "./bash-command-tables.ts";
import type { CapabilityFacts } from "./capability-facts.ts";

/** Wrappers the lexer peels (sudo, nohup, ssh, …) must be detected on the
 *  original segment heads, because `effective` starts at the real executable
 *  after peeling. */
export function classifySegmentHeads(
  segments: ShellSegment[],
  facts: CapabilityFacts,
): void {
  for (const segment of segments) classifySegmentHead(segment.tokens, facts);
}

function classifySegmentHead(
  tokens: ShellToken[],
  facts: CapabilityFacts,
): void {
  const k = commandStart(tokens);
  const headToken = tokens[k];
  if (headToken === undefined) return;
  const head = shellBasename(headToken.value);
  if (PRIVILEGE_WRAPPERS.has(head)) {
    facts.privilegeEscalation = true;
    facts.childProcesses = true;
  }
  if (PERSISTENCE_WRAPPERS.has(head)) {
    facts.persistence = true;
    facts.childProcesses = true;
  }
  if (SSH_TOOLS.has(head)) classifySshHead(tokens.slice(k + 1), facts);
}

function classifySshHead(tail: ShellToken[], facts: CapabilityFacts): void {
  facts.remoteEnabled = true;
  facts.childProcesses = true;
  // A remote command that mutates is a remote-mutation hint. The remote
  // command may be a single quoted token (`ssh host 'rm -rf /'`), so split
  // each tail token on whitespace before searching for mutation signals.
  const words = tail.flatMap((t) => t.value.split(/\s+/));
  if (words.some((v) => GIT_MUTATION_SUBCOMMANDS.has(v) || v === "rm")) {
    facts.remoteMutation = true;
  }
  claimUnsetClass(facts, "remote-operation");
}
