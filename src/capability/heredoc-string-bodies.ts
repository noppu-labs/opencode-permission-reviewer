// Keeping the commands the heredoc bodies of a command string run.

import {
  type BodyCommands,
  keepBodyCommands,
} from "./heredoc-body-commands.ts";
import { sanitizedText } from "./heredoc-sanitized.ts";

/** Keeps the commands the heredoc bodies of command string `text` run. */
export function keepStringBodies(
  bodies: BodyCommands | undefined,
  text: string,
): void {
  if (bodies === undefined || !text.includes("<<")) return;
  const read = sanitizedText(text);
  keepBodyCommands(bodies, read.bodyCommands, read.bodyUnresolved);
}
