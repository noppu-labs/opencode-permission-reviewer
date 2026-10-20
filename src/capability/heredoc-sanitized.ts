// A command text with its heredoc bodies collapsed, and the commands those bodies run.

import { extractHeredocs } from "./heredoc-extractor.ts";

export interface SanitizedText {
  text: string;
  /** The commands the collapsed bodies run, and whether one of the bodies
   *  could not be read to its end. */
  bodyCommands: string[];
  bodyUnresolved: boolean;
  /** The text each collapsed body gives the command that reads it. */
  scripts: ReadonlyMap<string, string>;
}

/** `text` with its heredoc bodies collapsed by the current extractor. */
export function sanitizedText(text: string): SanitizedText {
  const extraction = extractHeredocs(text);
  return {
    text: extraction.sanitizedCommand,
    bodyCommands: extraction.bodyCommands,
    bodyUnresolved: extraction.bodyUnresolved,
    scripts: extraction.scripts,
  };
}
