// Keeping what the heredoc bodies of a command string run and are read as.

import {
  type BodyCommands,
  keepBodyCommands,
} from "./heredoc-body-commands.ts";
import { sanitizedText } from "./heredoc-sanitized.ts";
import { feedsOf, keepBodyScripts } from "./heredoc-scripts.ts";

/** A shell or ssh word in a string: without one, no command in it reads a
 *  script from a heredoc. */
const SCRIPT_READER = /\b(?:sh|bash|zsh|dash|ksh|ash|mksh|ssh|busybox)\b/;

/** Keeps the commands the heredoc bodies of command string `text` run, and
 *  the string itself when it holds a heredoc and a word that may read it as
 *  a script, for the check of what its commands read from the heredoc. */
export function keepStringBodies(
  bodies: BodyCommands | undefined,
  text: string,
): void {
  if (bodies === undefined || !text.includes("<<")) return;
  const read = sanitizedText(text);
  keepBodyCommands(bodies, read.bodyCommands, read.bodyUnresolved);
  keepBodyScripts(bodies, read.scripts);
  if (read.scripts.size > 0 && SCRIPT_READER.test(read.text))
    feedsOf(bodies).commands.push(text);
}
