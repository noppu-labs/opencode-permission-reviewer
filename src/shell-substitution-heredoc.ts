// Heredocs inside a command substitution's body: their operators, and the body lines that cannot close it.

import type { PendingStart } from "./capability/heredoc-body-records.ts";
import { collectBody } from "./capability/heredoc-body-text.ts";
import { parseDelimiterWord } from "./capability/heredoc-delimiter.ts";

export type PendingHeredoc = Pick<PendingStart, "delimiter" | "resolved"> & {
  tabStripped: boolean;
};

/** The `<<` operator at `index`: the heredoc it opens (none for a `<<<`
 *  here-string) and the index just past its delimiter word. */
export function heredocOperatorAt(
  text: string,
  index: number,
): { heredoc?: PendingHeredoc; end: number } {
  let j = index + 2;
  if (text[j] === "<") return { end: j + 1 };
  const tabStripped = text[j] === "-";
  if (tabStripped) j += 1;
  while (text[j] === " " || text[j] === "\t") j += 1;
  const word = parseDelimiterWord(text, j);
  return {
    heredoc: {
      delimiter: word.delimiter,
      tabStripped,
      resolved: word.resolved,
    },
    end: word.wordEnd,
  };
}

/** Index just past the bodies of `heredocs`, read in operator order from
 *  `position`. A body whose terminator is unknowable runs to the end. */
export function heredocBodiesEnd(
  text: string,
  position: number,
  heredocs: readonly PendingHeredoc[],
): number {
  let end = position;
  for (const heredoc of heredocs) {
    end = heredoc.resolved
      ? collectBody(text, end, heredoc.delimiter, heredoc.tabStripped)
          .endIndex + 1
      : text.length;
  }
  return end;
}
