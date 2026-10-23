// What the commands of lexed segments read as scripts from a heredoc or here-string, and which interpreters run code written on the spot.

import { shellBasename } from "../shell/shell-lexer.ts";
import { STDIN_SCRIPT_SHELLS } from "../shell/shell-lexer-tables.ts";
import {
  buildFeedInput,
  type SegmentFeedParts,
} from "../shell/shell-script-feed-input.ts";
import {
  type ScriptFeed,
  scriptFeeds,
  stdinScripts,
} from "../shell/shell-script-feeds.ts";
import { shellReadsStdin } from "../shell/shell-script-readers.ts";
import type { ShellToken } from "../shell/shell-token.ts";
import { interpreterReadsStdin } from "../walk/interpreter-stdin.ts";
import { INTERPRETERS } from "./bash-command-tables.ts";

export interface FeedAnalysis {
  feeds: ScriptFeed[];
  /** A heredoc that feeds a command has no recorded body. */
  unresolved: boolean;
  /** An interpreter among the commands runs code from a heredoc or
   *  here-string. */
  stdinCode: boolean;
}

const NO_FEEDS: FeedAnalysis = {
  feeds: [],
  unresolved: false,
  stdinCode: false,
};

/** Whether a redirection of the segments is a heredoc or here-string: with
 *  none, no command reads a script that way. Each redirection is looked at
 *  once, however many commands inherit it. */
export function mayFeed(parts: readonly SegmentFeedParts[]): boolean {
  return parts.some(({ segmentRedirections }) =>
    segmentRedirections.some(({ operator }) => operator.includes("<<")),
  );
}

/** The scripts the commands of `parts` read, given the bodies recorded in
 *  `scripts`. */
export function analyzeFeeds(
  parts: readonly SegmentFeedParts[],
  scripts: ReadonlyMap<string, readonly string[]>,
): FeedAnalysis {
  if (!mayFeed(parts)) return NO_FEEDS;
  const input = buildFeedInput(parts, scripts);
  const stdinCode = input.effective.some(
    (words, index) => runsStdinCode(words) && stdinScripts(input, index).fed,
  );
  return { ...scriptFeeds(input), stdinCode };
}

/** An interpreter that would run what its stdin carries: without a script
 *  file or command string for a shell, without a script operand for the
 *  rest. */
function runsStdinCode(words: readonly ShellToken[]): boolean {
  const head = shellBasename(words[0]?.value ?? "");
  if (!INTERPRETERS.has(head)) return false;
  return STDIN_SCRIPT_SHELLS.has(head)
    ? shellReadsStdin(words)
    : interpreterReadsStdin(words);
}
