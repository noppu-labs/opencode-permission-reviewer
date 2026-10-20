// Wrapper detection on the segments' own words, for an analysis that a walk limit stopped short.

import { elementAt } from "../element-at.ts";
import { shellBasename } from "../shell-lexer.ts";
import {
  PREVIOUS_ENV_VALUE_OPTIONS,
  SHELL_KEYWORDS,
  TRANSPARENT_WRAPPERS,
} from "../shell-lexer-tables.ts";
import type { ShellSegment, ShellToken } from "../shell-token.ts";
import {
  chrootCommandIndex,
  commandStart,
  skipWrapperArguments,
  timeoutCommandIndex,
} from "../shell-wrapper-options.ts";
import { GIT_MUTATION_SUBCOMMANDS, SSH_TOOLS } from "./bash-command-tables.ts";
import type { CapabilityFacts } from "./capability-facts.ts";
import { classifyWrapperHead } from "./segment-heads.ts";

/** The walk reports no command past its depth or command limits. When one
 *  stopped it, each segment's own words are still read for the wrappers
 *  they start with, without descending into command strings, so a wrapper
 *  past the limit is not missed. */
export function classifyTruncatedSegmentHeads(
  segments: readonly ShellSegment[],
  facts: CapabilityFacts,
): void {
  for (const { tokens } of segments) {
    let k: number | undefined = commandStart(tokens);
    while (k !== undefined && k < tokens.length) {
      const head = shellBasename(valueAt(tokens, k));
      classifyWrapperHead(head, facts);
      if (SSH_TOOLS.has(head) && tailMutates(tokens, k + 1))
        facts.remoteMutation = true;
      k = wrappedCommandIndex(tokens, k, head);
    }
  }
}

/** The words after an ssh may hold its remote command as one quoted word
 *  (`ssh host 'rm -rf /'`), so each is split on whitespace. */
function tailMutates(tokens: readonly ShellToken[], from: number): boolean {
  for (let k = from; k < tokens.length; k += 1) {
    const words = valueAt(tokens, k).split(/\s+/);
    if (words.some((v) => GIT_MUTATION_SUBCOMMANDS.has(v) || v === "rm"))
      return true;
  }
  return false;
}

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
  if (head === "env")
    return skipWrapperArguments(tokens, k, head, PREVIOUS_ENV_VALUE_OPTIONS);
  if (TRANSPARENT_WRAPPERS.has(head))
    return skipWrapperArguments(tokens, k, head);
  return undefined;
}

/** `commandStart` from `start`, without copying the words after it. */
function tailStart(tokens: ShellToken[], start: number): number {
  let i = start;
  while (i < tokens.length && SHELL_KEYWORDS.has(valueAt(tokens, i))) i += 1;
  while (i < tokens.length && ASSIGNMENT.test(valueAt(tokens, i))) i += 1;
  return i;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function valueAt(tokens: readonly ShellToken[], k: number): string {
  return elementAt(tokens, k, "tokens").value;
}
