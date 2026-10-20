// The text a heredoc gives the command that reads it on stdin, kept by placeholder beside the commands its body runs.

import type { BodyCommands } from "./heredoc-body-commands.ts";
import {
  expandedBody,
  stripTabs,
  unescapedBody,
} from "./heredoc-body-reading.ts";

/** What a reading that found no heredoc holds. It is shared, never written
 *  to. */
export const NO_SCRIPTS: ReadonlyMap<string, readonly string[]> = new Map();

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

/** Notes that the body under `sha256` has no script to read: it has no
 *  terminator line, or its delimiter cannot be known. The placeholder then
 *  holds no reading, which differs from a placeholder that is missing. */
export function recordNoScript(into: BodyCommands, sha256: string): void {
  noteNoScript(into, heredocPlaceholder(sha256));
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
  scripts: ReadonlyMap<string, readonly string[]>,
): void {
  if (into === undefined || scripts.size === 0) return;
  for (const [placeholder, texts] of scripts) {
    noteNoScript(into, placeholder);
    for (const text of texts) addScript(into, placeholder, text);
  }
}

/** The scripts that shells and ssh read from a heredoc or here-string, and the
 *  command strings that hold a heredoc, found while `into` was filled: the
 *  checks that judge them run after those of the bodies' commands. */
export function feedsOf(into: BodyCommands): BodyCommands {
  into.feeds ??= { commands: [], unresolved: false };
  return into.feeds;
}

function noteNoScript(into: BodyCommands, placeholder: string): void {
  into.scripts ??= new Map();
  if (!into.scripts.has(placeholder)) into.scripts.set(placeholder, []);
}

/** A placeholder right before an operator character, as the extractor leaves
 *  it after a delimiter that an operator follows (`<<EOF|sh`, `<<EOF>f`).
 *  The lexer reads the two as one word. */
const GLUED_PLACEHOLDER = /(<HEREDOC:sha256:[a-f0-9]{12}>)(?=[|&<>])/g;
const GLUED_WORD = /<HEREDOC:sha256:[a-f0-9]{12}>(?=[|&<>])/;

/** The sanitized `text` with a space between each placeholder and the
 *  operator glued to it, so that a lexer reads the placeholder as a word of
 *  its own and the operator as the one the command had. The text is returned
 *  as it is when it has none. */
export function separatePlaceholders(text: string): string {
  return text.includes("<HEREDOC:")
    ? text.replace(GLUED_PLACEHOLDER, "$1 ")
    : text;
}

/** Whether a word of a lexed sanitized command holds a placeholder together
 *  with other text: a command that was not given `separatePlaceholders`. */
export function holdsGluedPlaceholder(word: string): boolean {
  return GLUED_WORD.test(word);
}

/** Bodies that are alike share a placeholder, and a quoted and an unquoted
 *  one of the same text read differently, so a placeholder holds every
 *  distinct text it was recorded with, each as an item of its own: a consumer
 *  lexes them one by one, and none changes how another is read. */
function addScript(
  into: BodyCommands,
  placeholder: string,
  text: string,
): void {
  into.scripts ??= new Map();
  const held = into.scripts.get(placeholder);
  if (held === undefined) into.scripts.set(placeholder, [text]);
  else if (!held.includes(text)) held.push(text);
}
