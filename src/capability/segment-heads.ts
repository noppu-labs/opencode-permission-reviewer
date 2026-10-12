// Wrapper detection on the original segment heads, for the wrappers the lexer peels out of `effective`.

import { elementAt } from "../element-at.ts";
import { shellBasename } from "../shell-lexer.ts";
import { TRANSPARENT_WRAPPERS } from "../shell-lexer-tables.ts";
import type { ShellSegment, ShellToken } from "../shell-token.ts";
import {
  chrootCommandIndex,
  commandStart,
  skipWrapperArguments,
  timeoutCommandIndex,
} from "../shell-wrapper-options.ts";
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
 *  after peeling. Wrapped commands are located with the walk's own option
 *  skipping. */
export function classifySegmentHeads(
  segments: ShellSegment[],
  facts: CapabilityFacts,
): void {
  for (const segment of segments) classifySegmentHead(segment.tokens, facts);
}

/** Classify the head at the command start and each command it wraps, so
 *  `sudo ssh …`, `busybox ssh …` and `chroot /r ssh …` reach the checks. */
function classifySegmentHead(
  tokens: ShellToken[],
  facts: CapabilityFacts,
): void {
  let k: number | undefined = commandStart(tokens);
  while (k !== undefined && k < tokens.length) {
    const head = shellBasename(elementAt(tokens, k, "tokens").value);
    classifyHead(tokens, k, head, facts);
    k = wrappedCommandIndex(tokens, k, head);
  }
}

/** Index of the command `head` wraps, as the effective-command walk peels
 *  it, or undefined when `head` wraps none. */
function wrappedCommandIndex(
  tokens: ShellToken[],
  k: number,
  head: string,
): number | undefined {
  if (head === "timeout")
    return tailStart(tokens, timeoutCommandIndex(tokens, k));
  if (head === "busybox") return tailStart(tokens, k + 1);
  if (head === "chroot")
    return tailStart(tokens, chrootCommandIndex(tokens, k));
  if (TRANSPARENT_WRAPPERS.has(head))
    return skipWrapperArguments(tokens, k, head);
  return undefined;
}

function tailStart(tokens: ShellToken[], start: number): number {
  return start + commandStart(tokens.slice(start));
}

function classifyHead(
  tokens: ShellToken[],
  k: number,
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
