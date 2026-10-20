// The text a heredoc gives the command that reads it on stdin, kept by placeholder beside the commands its body runs.

import type { BodyCommands } from "./heredoc-body-commands.ts";
import {
  expandedBody,
  stripTabs,
  unescapedBody,
} from "./heredoc-body-reading.ts";

/** What a reading that found no heredoc holds. It is shared, never written
 *  to. */
export const NO_SCRIPTS: ReadonlyMap<string, string> = new Map();

/** The token that stands for a body in a sanitized command, from the sha256
 *  of the body. */
export function heredocPlaceholder(sha256: string): string {
  return `<HEREDOC:sha256:${sha256.slice(0, 12)}>`;
}

/**
 * The text the command that reads a heredoc gets on stdin. An unquoted body
 * reaches it as the shell expands it: continuation lines joined, and a
 * backslash before `$`, a backtick or another backslash dropped, so that an
 * escaped substitution is one in the text. Substitutions stay as written. A
 * quoted body reaches it as written. `tabStripped` (`<<-`) removes the
 * leading tabs of the lines.
 */
export function heredocScriptText(
  body: string,
  quoted: boolean,
  tabStripped: boolean,
): string {
  if (quoted) return tabStripped ? stripTabs(body) : body;
  return unescapedBody(expandedBody(body, tabStripped));
}

/** Records the script of one body under its placeholder. A collector that is
 *  not there is a reading that keeps none. */
export function recordHeredocScript(
  into: BodyCommands | undefined,
  sha256: string,
  body: string,
  quoted: boolean,
  tabStripped: boolean,
): void {
  if (into === undefined) return;
  addScript(
    into,
    heredocPlaceholder(sha256),
    heredocScriptText(body, quoted, tabStripped),
  );
}

/** Adds the scripts of `scripts` to `into`. The collector allocates its map
 *  with the first script, so a reading with none costs nothing. */
export function keepBodyScripts(
  into: BodyCommands | undefined,
  scripts: ReadonlyMap<string, string>,
): void {
  if (into === undefined || scripts.size === 0) return;
  for (const [placeholder, text] of scripts) addScript(into, placeholder, text);
}

/** Bodies that are alike share a placeholder, and a quoted and an unquoted
 *  one of the same text read differently, so a placeholder holds each text it
 *  was recorded with, one after the other, and a text it already holds as
 *  whole lines is not added again. */
function addScript(
  into: BodyCommands,
  placeholder: string,
  text: string,
): void {
  into.scripts ??= new Map();
  const held = into.scripts.get(placeholder);
  if (held === undefined) into.scripts.set(placeholder, text);
  else if (held !== text && !`\n${held}\n`.includes(`\n${text}\n`))
    into.scripts.set(placeholder, `${held}\n${text}`);
}
