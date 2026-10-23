// Heredocs inside a command substitution's body: their operators, and the body lines that cannot close it.

import type { PendingStart } from "../capability/heredoc/heredoc-body-records.ts";
import { collectBody } from "../capability/heredoc/heredoc-body-text.ts";
import { parseDelimiterWord } from "../capability/heredoc/heredoc-delimiter.ts";
import type { HeredocReading } from "./shell-lex-state.ts";

export type PendingHeredoc = Pick<PendingStart, "delimiter" | "resolved"> & {
  tabStripped: boolean;
};

/** The `<<` operator at `index`: the heredoc it opens (none for a `<<<`
 *  here-string) and the index just past its delimiter word. */
export function heredocOperatorAt(
  text: string,
  index: number,
  reading: HeredocReading = "default",
): { heredoc?: PendingHeredoc; end: number } {
  let j = index + 2;
  if (text[j] === "<") return { end: j + 1 };
  const tabStripped = text[j] === "-";
  if (tabStripped) j += 1;
  while (text[j] === " " || text[j] === "\t") j += 1;
  const word = parseDelimiterWord(text, j, {
    stopAtCarriageReturn: reading === "legacy",
  });
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
 *  `position`. A body whose terminator is unknowable runs to the end. Under
 *  `parenTerminates`, a line that holds the delimiter and then a `)` ends its
 *  body too, and the index returned is that `)`: it closes the substitution
 *  the heredoc is in. */
export function heredocBodiesEnd(
  text: string,
  position: number,
  heredocs: readonly PendingHeredoc[],
  parenTerminates = false,
): number {
  let end = position;
  for (const heredoc of heredocs) {
    if (!heredoc.resolved) {
      end = text.length;
    } else if (parenTerminates) {
      const body = bodyEnd(text, end, heredoc);
      if (body.paren) return body.end;
      end = body.end;
    } else {
      end =
        collectBody(text, end, heredoc.delimiter, heredoc.tabStripped)
          .endIndex + 1;
    }
  }
  return end;
}

/** Where the body that starts at `from` ends: just past its delimiter line,
 *  or at the `)` that follows the delimiter on a line. A body with neither
 *  runs to the end. Each line is read once, up to that line. */
function bodyEnd(
  text: string,
  from: number,
  heredoc: PendingHeredoc,
): { end: number; paren: boolean } {
  let line = from;
  while (line < text.length) {
    const found = text.indexOf("\n", line);
    const lineEnd = found === -1 ? text.length : found;
    const ends = terminatorAt(text, line, lineEnd, heredoc);
    if (ends !== undefined) return ends;
    line = lineEnd + 1;
  }
  return { end: text.length + 1, paren: false };
}

/** How the line `[line, lineEnd)` ends the body, if it does: it is the
 *  delimiter, or holds the delimiter and then a `)`. */
function terminatorAt(
  text: string,
  line: number,
  lineEnd: number,
  { delimiter, tabStripped }: PendingHeredoc,
): { end: number; paren: boolean } | undefined {
  let at = line;
  while (tabStripped && text[at] === "\t") at += 1;
  if (!text.startsWith(delimiter, at)) return undefined;
  at += delimiter.length;
  if (at === lineEnd) return { end: lineEnd + 1, paren: false };
  const paren = delimiter === "" ? -1 : parenAfter(text, at);
  return paren < 0 ? undefined : { end: paren, paren: true };
}

/** The index of the `)` at `from` or after blanks, or -1. */
function parenAfter(text: string, from: number): number {
  let at = from;
  while (text[at] === " " || text[at] === "\t") at += 1;
  return text[at] === ")" ? at : -1;
}
