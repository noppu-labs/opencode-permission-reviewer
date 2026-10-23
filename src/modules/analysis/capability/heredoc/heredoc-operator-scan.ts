// The scan steps that read a newline and a heredoc operator: where a start line's bodies are read and where a pending heredoc is opened.

import { appendText, consumeBodies } from "./heredoc-bodies.ts";
import { parseDelimiterWord } from "./heredoc-delimiter.ts";
import type { HeredocScan } from "./heredoc-extractor.ts";
import { innermostLimit, insideSubstitution } from "./heredoc-frame-bounds.ts";
import { enclosingSubstitution, readsNoBody } from "./heredoc-frame-starts.ts";

export function scanNewline(scan: HeredocScan): void {
  if (scan.pending.length === 0) {
    scan.lineStart = scan.i + 1;
    scan.i += 1;
    return;
  }
  appendText(scan, scan.command.slice(scan.cursor, scan.i));
  const resume = consumeBodies(scan, scan.i + 1, scan.i);
  scan.out += "\n";
  scan.cursor = resume;
  scan.i = resume;
  // The resume is where the text the scan reads next begins; a body cut at a
  // close resumes mid-line, and the skipped body text is not part of the line.
  scan.lineStart = resume;
}

export function scanHeredocOperator(scan: HeredocScan): void {
  const { command, i } = scan;
  let j = i + 2;
  const operator = command[j] === "-" ? "<<-" : "<<";
  if (operator === "<<-") j += 1;
  if (command[j] === "<") {
    // Here-string: the word is an inline argument, not a body.
    scan.i = j + 1;
    return;
  }
  if (!scan.readAllOperators && readsNoBody(scan)) {
    // Inside an expansion the shell reads `<<` as literal or shift text: no
    // heredoc opens and no body is read.
    scan.i += 2;
    return;
  }
  while (j < command.length && (command[j] === " " || command[j] === "\t"))
    j += 1;
  const frame = enclosingSubstitution(scan.frames);
  const word = parseDelimiterWord(command, j, {
    stopAtBacktick: frame?.kind === "backtick",
    stopAtCarriageReturn: scan.legacy,
  });
  const limit = innermostLimit(scan.frames);
  if (insideSubstitution(scan.frames)) scan.framed = true;
  appendText(scan, command.slice(scan.cursor, i));
  scan.pending.push({
    operator,
    delimiter: word.delimiter,
    rawWord: command.slice(j, word.wordEnd),
    quoted: word.quoted,
    resolved: word.resolved,
    opStart: i,
    wordEnd: word.wordEnd,
    lineStart: scan.lineStart,
    ...(frame === undefined ? {} : { frame }),
    ...(limit === undefined ? {} : { limit }),
  });
  scan.pieces.push({ pendingIndex: scan.pending.length - 1 });
  scan.cursor = word.wordEnd;
  scan.i = word.wordEnd;
}
