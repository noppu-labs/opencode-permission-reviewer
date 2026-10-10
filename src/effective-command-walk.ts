// The effective-command walk: peels one level of a segment and re-enters command strings and operand tails under the depth and expansion caps.

import { elementAt } from "./element-at.ts";
import { envSplitString } from "./env-split-string.ts";
import { wrapperCommandString } from "./shell-command-strings.ts";
import {
  type AnalysisBudget,
  shellBasename as basename,
  MAX_EFFECTIVE_COMMANDS,
} from "./shell-lexer.ts";
import { TRANSPARENT_WRAPPERS } from "./shell-lexer-tables.ts";
import {
  normalizeShellRedirections,
  type ShellRedirection,
} from "./shell-redirections.ts";
import { lexSegments } from "./shell-scanner.ts";
import type { ShellToken } from "./shell-token.ts";
import {
  chrootCommandIndex,
  commandStart,
  skipWrapperArguments,
  timeoutCommandIndex,
} from "./shell-wrapper-options.ts";
import { sshRemoteCommand } from "./ssh-remote-command.ts";

/** Ceiling on command-string re-entry (`sh -c`, `env -S`, ssh, busybox,
 *  chroot). Deeper nesting than this is not a legitimate review shape; the
 *  walk stops descending and the unanalyzed remainder stays the model
 *  reviewer's job, keeping unbounded input from exhausting the stack. */
const MAX_WALK_DEPTH = 32;

/** Where every level of one walk collects its effective commands. */
export interface WalkSink {
  commands: ShellToken[][];
  redirections: ShellRedirection[][];
  truncated: boolean;
  budget: AnalysisBudget;
}

/** One level of the walk: the redirections its commands carry, inherited
 *  ones first, and its command-string re-entry depth. */
interface WalkLevel {
  sink: WalkSink;
  redirections: ShellRedirection[];
  depth: number;
}

export function walk(
  tokens: ShellToken[],
  sink: WalkSink,
  inheritedRedirections: ShellRedirection[],
  depth: number,
): void {
  // Depth and expansion budget: recursion here is driven by the (untrusted)
  // command text, so both bounds are hard stops, not tuning knobs. Hitting
  // either one marks the analysis truncated so downstream gates know the
  // collected commands do not cover the whole command.
  if (
    depth > MAX_WALK_DEPTH ||
    sink.commands.length >= MAX_EFFECTIVE_COMMANDS ||
    sink.budget.remainingCommands <= 0
  ) {
    sink.truncated = true;
    return;
  }
  const normalized = normalizeShellRedirections(tokens);
  const words = normalized.tokens;
  const level: WalkLevel = {
    sink,
    redirections: [...inheritedRedirections, ...normalized.redirections],
    depth,
  };
  let i: number | undefined = commandStart(words);
  while (i !== undefined && i < words.length) i = peel(words, i, level);
}

/** Resolve the word at `i`. Returns the index to resume at after a
 *  transparent wrapper, or `undefined` once this level is done. */
function peel(
  words: ShellToken[],
  i: number,
  level: WalkLevel,
): number | undefined {
  const word = elementAt(words, i, "tokens").value;
  if (word === "--") return undefined;
  const base = basename(word);
  if (base === "env" && reanalyzeIfPresent(envSplitString(words, i), level))
    return undefined;
  if (base === "timeout") {
    walkTail(words, timeoutCommandIndex(words, i), level);
    return undefined;
  }
  if (TRANSPARENT_WRAPPERS.has(base))
    return skipWrapperArguments(words, i, base);
  peelCommand(words, i, base, level);
  return undefined;
}

/** The checks after the transparent wrappers, in order: a command string,
 *  an operand tail, or the effective command itself. */
function peelCommand(
  words: ShellToken[],
  i: number,
  base: string,
  level: WalkLevel,
): void {
  if (reanalyzeIfPresent(wrapperCommandString(words, i, base), level)) return;
  if (base === "ssh") {
    reanalyzeIfPresent(sshRemoteCommand(words, i), level);
    return;
  }
  if (base === "busybox") {
    walkTail(words, i + 1, level);
    return;
  }
  if (base === "chroot") {
    walkTail(words, chrootCommandIndex(words, i), level);
    return;
  }
  const { sink } = level;
  sink.commands.push(words.slice(i));
  sink.redirections.push(level.redirections);
  sink.budget.remainingCommands -= 1;
}

/** Re-analyze `text` when there is one; reports whether it did. */
function reanalyzeIfPresent(text: string | null, level: WalkLevel): boolean {
  if (text === null) return false;
  reanalyze(text, level);
  return true;
}

/** Re-lex a command string and walk each of its segments one level deeper.
 *  Its length is charged to the re-analysis budget first. */
function reanalyze(text: string, level: WalkLevel): void {
  const { sink } = level;
  sink.budget.remainingReanalysisChars -= text.length;
  if (sink.budget.remainingReanalysisChars < 0) {
    sink.truncated = true;
    return;
  }
  for (const sub of lexSegments(text))
    walk(sub.tokens, sink, level.redirections, level.depth + 1);
}

/** Walk the operand tail from `start` one level deeper, if any is left. */
function walkTail(words: ShellToken[], start: number, level: WalkLevel): void {
  if (start < words.length)
    walk(words.slice(start), level.sink, level.redirections, level.depth + 1);
}
