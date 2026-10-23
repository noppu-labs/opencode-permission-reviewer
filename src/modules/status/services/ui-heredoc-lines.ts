// The extractor's stored body is bounded, so each count is read from the
// original command.

import { createHash } from "node:crypto";
import { collectBody } from "../../analysis/capability/heredoc/heredoc-body-text.ts";
import type { HeredocExtraction } from "../../analysis/capability/heredoc/heredoc-extractor.ts";
import type { HeredocRecord } from "../../analysis/capability/models/capability-types.ts";

/** A heredoc body in the original command: its line count, and where it
 *  starts and ends (past its delimiter line). */
export interface HeredocBody {
  lines: number;
  start: number;
  end: number;
}

const PLACEHOLDER = /<HEREDOC:sha256:[0-9a-f]{12}>/g;
/** How the sanitized command marks a delimiter it could not resolve. */
const UNRESOLVED = "'<unresolved>' ";

const newlines = (text: string): number => text.split("\n").length - 1;

function lineStarts(command: string): number[] {
  const starts = [0];
  for (
    let index = command.indexOf("\n");
    index !== -1;
    index = command.indexOf("\n", index + 1)
  )
    starts.push(index + 1);
  return starts;
}

/** Whether the body read at `position` ended at its delimiter line rather
 *  than at the end of the command. */
function closed(
  command: string,
  position: number,
  read: { body: string; endIndex: number },
  record: HeredocRecord,
): boolean {
  const lineStart = position + read.body.length;
  if (lineStart > read.endIndex) return false;
  const line = command.slice(lineStart, read.endIndex);
  const candidate = record.operator === "<<-" ? line.replace(/^\t+/, "") : line;
  return candidate === record.delimiter;
}

/**
 * Each heredoc's body, in operator order. A body is read at the position the
 * sanitized command implies, which is an inference, so it is kept only when
 * its hash matches the extractor's record and it ends at its delimiter line.
 */
export function heredocBodies(
  command: string,
  extraction: HeredocExtraction,
): HeredocBody[] | undefined {
  const { sanitizedCommand: sanitized, heredocs } = extraction;
  const starts = lineStarts(command);
  const bodies: HeredocBody[] = [];
  let removed = 0;
  let line = -1;
  let position = 0;
  for (const match of sanitized.matchAll(PLACEHOLDER)) {
    const record = heredocs[bodies.length];
    const before = sanitized.slice(0, match.index);
    if (record === undefined || before.endsWith(UNRESOLVED)) return undefined;
    const placeholderLine = newlines(before);
    if (placeholderLine !== line) {
      line = placeholderLine;
      position = starts[line + removed + 1] ?? command.length;
    }
    const read = collectBody(
      command,
      position,
      record.delimiter,
      record.operator === "<<-",
    );
    const digest = createHash("sha256").update(read.body).digest("hex");
    if (
      digest !== record.bodySha256 ||
      !closed(command, position, read, record)
    )
      return undefined;
    const end = Math.min(read.endIndex + 1, command.length);
    bodies.push({ lines: newlines(read.body), start: position, end });
    removed += newlines(command.slice(position, end));
    position = end;
  }
  return bodies.length === heredocs.length ? bodies : undefined;
}
