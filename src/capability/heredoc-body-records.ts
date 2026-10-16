// Reading one pending heredoc's body and recording its digest, bound, dynamic flag and output target.

import { createHash } from "node:crypto";
import {
  boundBody,
  collectBody,
  containsDynamic,
  findOutputTarget,
} from "./heredoc-body-text.ts";
import type { Frame } from "./heredoc-scan-context.ts";

/** A heredoc operator whose body has not been read yet. */
export interface PendingStart {
  operator: string;
  delimiter: string;
  rawWord: string;
  quoted: boolean;
  resolved: boolean;
  opStart: number;
  wordEnd: number;
  lineStart: number;
  /** The substitution the operator sits inside, if any — directly or under
   *  nested groups. A substitution that closes on the operator's own line
   *  drops the start: the shell reads the close before any body line. */
  frame?: Frame;
  /** The index where the innermost bounded construct (a backtick, or a `$((`
   *  substitution) closes; the body ends there. */
  limit?: number;
}

/** One read body, bounded for the record. */
export interface BodyRecord {
  bounded: string;
  sha256: string;
  truncated: boolean;
  dynamic: boolean;
  outputTarget?: string;
}

/** Read one pending heredoc's body from `position`, bounded by `limit` when
 *  given. Returns it with the index the next text is read from: just past its
 *  terminator line, or the bound itself when the body is cut there. */
export function readBody(
  command: string,
  position: number,
  start: PendingStart,
  limit?: number,
): {
  body: string;
  truncated: boolean;
  unterminated: boolean;
  position: number;
} {
  if (start.resolved) {
    const collected = collectBody(
      command,
      position,
      start.delimiter,
      start.operator === "<<-",
      limit,
    );
    return {
      body: collected.body,
      truncated: collected.truncated,
      unterminated: collected.unterminated,
      position: collected.unterminated
        ? collected.endIndex
        : collected.endIndex + 1,
    };
  }
  if (limit !== undefined) {
    return {
      body: command.slice(position, limit),
      truncated: true,
      unterminated: true,
      position: limit,
    };
  }
  // The terminator line cannot be known statically, so no line of the
  // remainder can be proven to be a command: it all becomes the body
  // instead of leaking into the analyzer as tokens.
  return {
    body: command.slice(position),
    truncated: true,
    unterminated: true,
    position: command.length,
  };
}

/** The `<` marks of a start line, found once per line. The output-target
 *  pattern cannot match a `<`, so a target always lies after the last `<` of
 *  the window it is searched in: `lastLess` is the last `<` before the line's
 *  end, and `tail` the target found after it. */
export interface LineTargets {
  lastLess: number;
  tail: string | undefined;
}

export function lineTargets(command: string, lineEnd: number): LineTargets {
  const lastLess = command.lastIndexOf("<", lineEnd - 1);
  return {
    lastLess,
    tail:
      lastLess < 0
        ? undefined
        : findOutputTarget(command.slice(lastLess + 1, lineEnd)),
  };
}

/** The target before a start's operator: the window starts after the last `<`
 *  before the operator, or at the line start, whichever is later. */
function targetBefore(
  command: string,
  start: PendingStart,
): string | undefined {
  const lastLess =
    start.opStart > 0 ? command.lastIndexOf("<", start.opStart - 1) : -1;
  return findOutputTarget(
    command.slice(Math.max(start.lineStart, lastLess + 1), start.opStart),
  );
}

/** The target after a start's delimiter word, up to the line's end. When a `<`
 *  lies after the word, the target is the line's shared `tail`; otherwise the
 *  window holds no `<` and is searched directly. */
function targetAfter(
  command: string,
  start: PendingStart,
  lineEnd: number,
  targets: LineTargets,
): string | undefined {
  if (targets.lastLess >= start.wordEnd) return targets.tail;
  return findOutputTarget(command.slice(start.wordEnd, lineEnd));
}

export function bodyRecord(
  command: string,
  start: PendingStart,
  read: { body: string; truncated: boolean },
  lineEnd: number,
  targets: LineTargets,
): BodyRecord {
  const sha256hex = createHash("sha256").update(read.body).digest("hex");
  const dynamic = start.resolved
    ? containsDynamic(read.body, start.quoted)
    : true;
  const { bounded, wasTruncated } = boundBody(read.body, read.truncated);
  // The output target may sit before the operator (`cat > /tmp/x <<EOF`)
  // or after the delimiter word (`cat <<EOF > /tmp/x`); both positions
  // redirect the same command's output.
  const outputTarget =
    targetBefore(command, start) ??
    targetAfter(command, start, lineEnd, targets);
  return {
    bounded,
    sha256: sha256hex,
    truncated: wasTruncated,
    dynamic,
    ...(outputTarget === undefined ? {} : { outputTarget }),
  };
}
