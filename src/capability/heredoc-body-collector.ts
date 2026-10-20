// Collecting the commands heredoc bodies run into the collector a reading keeps.

import {
  type BodyCommands,
  heredocBodyCommands,
} from "./heredoc-body-commands.ts";

/** Adds commands to `into`, with whether their bodies were unresolved. A
 *  collector that is not there is a reading that keeps none. */
export function keepBodyCommands(
  into: BodyCommands | undefined,
  commands: string[],
  unresolved: boolean,
): void {
  if (into === undefined || (commands.length === 0 && !unresolved)) return;
  for (const command of commands) into.commands.push(command);
  into.unresolved ||= unresolved;
}

/** Adds the commands of one unquoted body to `into`. */
export function addBodyCommands(
  into: BodyCommands,
  body: string,
  tabStripped: boolean,
): void {
  const found = heredocBodyCommands(body, tabStripped);
  keepBodyCommands(into, found.commands, found.unresolved);
}
