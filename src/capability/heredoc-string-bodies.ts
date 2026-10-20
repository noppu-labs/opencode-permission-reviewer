// Keeping what the heredoc bodies of a command string run and are read as.

import {
  type BodyCommands,
  keepBodyCommands,
} from "./heredoc-body-commands.ts";
import { sanitizedText } from "./heredoc-sanitized.ts";
import { keepBodyScripts } from "./heredoc-scripts.ts";

/** Keeps the commands the heredoc bodies of command string `text` run. */
export function keepStringBodies(
  bodies: BodyCommands | undefined,
  text: string,
): void {
  if (bodies === undefined || !text.includes("<<")) return;
  const read = sanitizedText(text);
  keepBodyCommands(bodies, read.bodyCommands, read.bodyUnresolved);
  keepBodyScripts(bodies, read.scripts);
}
