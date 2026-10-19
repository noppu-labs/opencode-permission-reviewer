// The heredoc readings of one command, which do not depend on the quote reading, computed once for all of the brake's passes.

import {
  extractHeredocs,
  type HeredocExtraction,
} from "./capability/heredoc-extractor.ts";
import { legacySanitizedCommand } from "./capability/heredoc-legacy.ts";

/** The default heredoc extraction, the text with every operator collapsed,
 *  and the previous release's sanitized text. */
export interface HeredocTexts {
  extraction: HeredocExtraction;
  allOperators: string;
  legacy: string;
}

let last: { command: string; texts: HeredocTexts } | undefined;

/** The heredoc readings of `command`. The brake reads one command under
 *  each quote reading in turn, so the last command's readings are kept. */
export function heredocTexts(command: string): HeredocTexts {
  if (last?.command === command) return last.texts;
  const texts: HeredocTexts = {
    extraction: extractHeredocs(command),
    allOperators: extractHeredocs(command, { readAllOperators: true })
      .sanitizedCommand,
    legacy: legacySanitizedCommand(command),
  };
  last = { command, texts };
  return texts;
}
