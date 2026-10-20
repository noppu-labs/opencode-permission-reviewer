// The scripts that the commands of walked segments read from a heredoc or here-string, found in the walk's own results.

import { lexSegmentsBounded, newAnalysisBudget } from "../shell-lexer.ts";
import type { ScriptFeed } from "../shell-script-feeds.ts";
import type { Walked } from "./command-walk.ts";
import { newWalked, walkSegments } from "./command-walk.ts";
import { NO_SCRIPTS, separatePlaceholders } from "./heredoc-scripts.ts";
import { analyzeFeeds, type FeedAnalysis } from "./script-feed-analysis.ts";

type Scripts = ReadonlyMap<string, readonly string[]>;

const NO_FEEDS: ScriptFeed[] = [];

/** The scripts the commands of the segments of `text`, walked from part
 *  `from` on, read: none without a `<<` in `text`. The walk records what they
 *  show: an interpreter that runs code from a heredoc or here-string, and a
 *  heredoc whose body is not known, which leaves the analysis incomplete. */
export function feedsAfterWalk(
  into: Walked,
  from: number,
  text: string,
  lexScripts: Scripts,
): ScriptFeed[] {
  if (!text.includes("<<")) return NO_FEEDS;
  return noteFeeds(into, analyzeFeeds(into.parts.slice(from), lexScripts));
}

/** The feeds of the command `sanitized` that `walked` walked from `lexScripts`
 *  and the `extracted` bodies. A placeholder that sits right before an
 *  operator is read again with the two apart, so that its pipes and
 *  redirections are the ones the command had. */
export function mainFeeds(
  sanitized: string,
  walked: Walked,
  extracted: Scripts,
  lexScripts: Scripts,
): ScriptFeed[] {
  if (!sanitized.includes("<<")) return NO_FEEDS;
  const separated = separatePlaceholders(sanitized);
  const parts =
    separated === sanitized ? walked.parts : separatedParts(separated);
  const scripts = mergeScripts([extracted, lexScripts]);
  return noteFeeds(walked, analyzeFeeds(parts, scripts));
}

function separatedParts(separated: string): Walked["parts"] {
  const walked = newWalked();
  const lex = lexSegmentsBounded(separated);
  const budget = newAnalysisBudget("default", "bash", {
    commands: [],
    unresolved: false,
  });
  walkSegments(lex.segments, budget, walked);
  return walked.parts;
}

function noteFeeds(into: Walked, found: FeedAnalysis): ScriptFeed[] {
  into.stdinCode ||= found.stdinCode;
  into.truncated ||= found.unresolved;
  return found.feeds.length === 0 ? NO_FEEDS : found.feeds;
}

/** The scripts recorded under each placeholder by every source that holds
 *  any, which is the one source itself when only one does. */
function mergeScripts(sources: readonly Scripts[]): Scripts {
  const held = sources.filter((scripts) => scripts.size > 0);
  const [first] = held;
  if (first === undefined || held.length === 1) return first ?? NO_SCRIPTS;
  const merged = new Map<string, string[]>();
  for (const scripts of held) addAll(merged, scripts);
  return merged;
}

function addAll(into: Map<string, string[]>, scripts: Scripts): void {
  for (const [placeholder, texts] of scripts) {
    const known = into.get(placeholder) ?? [];
    for (const text of texts) if (!known.includes(text)) known.push(text);
    into.set(placeholder, known);
  }
}
