// The scripts a shell or ssh reads from a heredoc or here-string, added to the commands the brake judges after its own passes.

import type { BodyCommands } from "../capability/heredoc/heredoc-body-commands.ts";
import { feedsOf, NO_SCRIPTS } from "../capability/heredoc/heredoc-scripts.ts";
import { analyzeFeeds } from "../capability/script-feed-analysis.ts";
import type { SegmentFeedParts } from "../shell/shell-script-feed-input.ts";

/** Adds the scripts the commands of `parts` read to `bodies.feeds`, which the
 *  brake judges after the commands heredoc bodies run. A heredoc whose script
 *  is not recorded makes the feeds unresolved. */
export function keepScriptFeeds(
  parts: readonly SegmentFeedParts[],
  bodies: BodyCommands,
): void {
  const found = analyzeFeeds(parts, bodies.scripts ?? NO_SCRIPTS);
  if (found.feeds.length === 0 && !found.unresolved) return;
  const feeds = feedsOf(bodies);
  for (const { script } of found.feeds) feeds.commands.push(script);
  feeds.unresolved ||= found.unresolved;
}

/** Notes that a command which reads a script could not be read apart. */
export function keepFeedsUnresolved(bodies: BodyCommands): void {
  feedsOf(bodies).unresolved = true;
}
