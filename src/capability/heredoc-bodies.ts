// Reading the bodies of a start line's pending heredocs, recording them and replacing each operator with its placeholder.

import { elementAt } from "../element-at.ts";
import type { HeredocRecord } from "./capability-types.ts";
import { addBodyCommands } from "./heredoc-body-collector.ts";
import type { BodyCommands } from "./heredoc-body-commands.ts";
import {
  type BodyRecord,
  bodyRecord,
  lineTargets,
  type PendingStart,
  readBody,
} from "./heredoc-body-records.ts";
import {
  heredocPlaceholder,
  recordHeredocScript,
  recordNoScript,
} from "./heredoc-scripts.ts";

/** The part of the heredoc scan state a start line's bodies are read into:
 *  `pieces` holds the start line, with each pending operator in its place,
 *  until the line's bodies are read. */
export interface PendingLine {
  command: string;
  heredocs: HeredocRecord[];
  hasDynamicConstructs: boolean;
  out: string;
  /** Set when a body read reaches the end of input without its terminator
   *  line, or its delimiter word cannot be known. */
  unterminated: boolean;
  pending: PendingStart[];
  pieces: Array<{ text: string } | { pendingIndex: number }>;
  /** Where the commands the unquoted bodies run are kept; a scan that does
   *  not read them leaves it unset. */
  bodies?: BodyCommands;
}

export function appendText(scan: PendingLine, text: string): void {
  if (text.length === 0) return;
  const last = scan.pieces.at(-1);
  if (last !== undefined && "text" in last) last.text += text;
  else scan.pieces.push({ text });
}

/** Consume the body of every pending heredoc in operator order, emit the
 *  sanitized start line, and return the index the scan continues from.
 *  `lineEnd` is the newline (or end of command) that closed the start
 *  line, so redirections after the operator stay visible. */
export function consumeBodies(
  scan: PendingLine,
  bodyStart: number,
  lineEnd: number,
): number {
  let position = bodyStart;
  const records: BodyRecord[] = [];
  const targets = lineTargets(scan.command, lineEnd);
  for (const start of scan.pending) {
    // A bound counts only past the start line's newline: a close the scan
    // passed over on that line bounds nothing.
    const bound =
      start.limit !== undefined && start.limit > lineEnd
        ? start.limit
        : undefined;
    const read = readBody(scan.command, position, start, bound);
    position = read.position;
    if (read.unterminated) scan.unterminated = true;
    const record = bodyRecord(scan.command, start, read, lineEnd, targets);
    if (record.dynamic) scan.hasDynamicConstructs = true;
    keepBody(scan.bodies, start, read, record.sha256);
    records.push(record);
  }
  scan.out += sanitizedStartLine(scan, records);
  for (const [index, start] of scan.pending.entries())
    scan.heredocs.push(
      heredocRecord(start, elementAt(records, index, "records")),
    );
  scan.pending.length = 0;
  scan.pieces = [];
  return position;
}

/** Keeps what one read body gives the collector: the commands its
 *  substitutions run, when its delimiter is unquoted, and the text the command
 *  that reads it gets, when it has its terminator line. */
function keepBody(
  bodies: BodyCommands | undefined,
  start: PendingStart,
  read: { body: string; unterminated: boolean },
  sha256: string,
): void {
  if (bodies === undefined) return;
  if (!start.resolved || read.unterminated) recordNoScript(bodies, sha256);
  if (!start.resolved) return;
  const tabStripped = start.operator === "<<-";
  if (!start.quoted) addBodyCommands(bodies, read.body, tabStripped);
  if (!read.unterminated)
    recordHeredocScript(bodies, sha256, read.body, start.quoted, tabStripped);
}

/** The current start line with each operator and its word replaced by the
 *  placeholder for its body. */
function sanitizedStartLine(scan: PendingLine, records: BodyRecord[]): string {
  let assembled = "";
  for (const piece of scan.pieces) {
    if ("text" in piece) {
      assembled += piece.text;
      continue;
    }
    const start = elementAt(scan.pending, piece.pendingIndex, "pending");
    const record = elementAt(records, piece.pendingIndex, "records");
    const shown = start.resolved ? start.delimiter : "<unresolved>";
    const safe = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(shown)
      ? shown
      : `'${shown.replace(/'/g, "'\\''")}'`;
    assembled += `${start.operator}${safe} ${heredocPlaceholder(record.sha256)}`;
  }
  return assembled;
}

function heredocRecord(start: PendingStart, record: BodyRecord): HeredocRecord {
  return {
    delimiter: start.resolved ? start.delimiter : start.rawWord,
    operator: start.operator,
    expansionDisabled: start.quoted,
    bodyBounded: record.bounded,
    bodySha256: record.sha256,
    truncated: record.truncated,
    ...(record.outputTarget === undefined
      ? {}
      : { outputTarget: record.outputTarget }),
    dynamic: record.dynamic,
  };
}
