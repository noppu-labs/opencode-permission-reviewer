// The effective-command walk: peels one level of a segment and re-enters command strings and operand tails under the depth and expansion caps.

import { elementAt } from "./element-at.ts";
import { envSplitString } from "./env-split-string.ts";
import { operandTailIndex } from "./operand-tail-index.ts";
import { wrapperCommandString } from "./shell-command-strings.ts";
import { shellBasename as basename } from "./shell-lexer.ts";
import { TRANSPARENT_WRAPPERS } from "./shell-lexer-tables.ts";
import {
  normalizeShellRedirections,
  type ShellRedirection,
} from "./shell-redirections.ts";
import { shellReadsStdin } from "./shell-script-readers.ts";
import type { ShellToken } from "./shell-token.ts";
import {
  commandStart,
  skipWrapperArguments,
  timeoutCommandIndex,
} from "./shell-wrapper-options.ts";
import { remoteCommandTexts } from "./ssh-remote-command.ts";
import { walkLimitReached } from "./walk-limits.ts";
import { reanalysisSegments } from "./walk-reanalysis.ts";
import type { WalkLevel, WalkSink } from "./walk-sink.ts";
import { peelWatch } from "./watch-command.ts";

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
  if (walkLimitReached(sink, depth)) {
    sink.truncated = true;
    return;
  }
  const normalized = normalizeShellRedirections(tokens);
  sink.segmentRedirections.push(...normalized.redirections);
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
  if (base === "watch")
    return peelWatch(words, i, (text) => reanalyze(text, level));
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
  const commandString = wrapperCommandString(words, i, base);
  if (commandString !== null && shellReadsStdin(words, i))
    level.sink.stdinShells.push(level.redirections);
  if (reanalyzeIfPresent(commandString, level)) return;
  const remotes = remoteCommandTexts(
    words,
    i,
    base,
    level.sink.budget.previousSsh === true,
  );
  if (remotes !== undefined) {
    for (const text of remotes)
      if (!reanalyzeIfPresent(text, level))
        level.sink.bareSsh.push(level.redirections);
    return;
  }
  const tail = operandTailIndex(words, i, base);
  if (tail !== undefined) {
    walkTail(words, tail, level);
    return;
  }
  const { sink } = level;
  sink.commands.push(words.slice(i));
  sink.redirections.push(level.redirections);
  sink.budget.remainingCommands -= 1;
}

function reanalyzeIfPresent(text: string | null, level: WalkLevel): boolean {
  if (text === null) return false;
  reanalyze(text, level);
  return true;
}

/** Re-lex a command string and walk each of its segments one level deeper. */
function reanalyze(text: string, level: WalkLevel): void {
  for (const sub of reanalysisSegments(text, level.sink) ?? [])
    walk(sub.tokens, level.sink, level.redirections, level.depth + 1);
}

/** Walk the operand tail from `start` one level deeper, if any is left. */
function walkTail(words: ShellToken[], start: number, level: WalkLevel): void {
  if (start < words.length)
    walk(words.slice(start), level.sink, level.redirections, level.depth + 1);
}
