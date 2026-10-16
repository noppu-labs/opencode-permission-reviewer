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

export function bodyRecord(
  command: string,
  start: PendingStart,
  read: { body: string; truncated: boolean },
  lineEnd: number,
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
    findOutputTarget(command.slice(start.lineStart, start.opStart)) ??
    findOutputTarget(command.slice(start.wordEnd, lineEnd));
  return {
    bounded,
    sha256: sha256hex,
    truncated: wasTruncated,
    dynamic,
    ...(outputTarget === undefined ? {} : { outputTarget }),
  };
}
