// Reading one pending heredoc's body and recording its digest, bound, dynamic flag and output target.

import { createHash } from "node:crypto";
import {
  boundBody,
  collectBody,
  containsDynamic,
  findOutputTarget,
} from "./heredoc-body-text.ts";

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
}

/** One read body, bounded for the record. */
export interface BodyRecord {
  bounded: string;
  sha256: string;
  truncated: boolean;
  dynamic: boolean;
  outputTarget?: string;
}

/** Read one pending heredoc's body from `position`; returns it with the
 *  index just past its terminator line. */
export function readBody(
  command: string,
  position: number,
  start: PendingStart,
): { body: string; truncated: boolean; position: number } {
  if (start.resolved) {
    const collected = collectBody(
      command,
      position,
      start.delimiter,
      start.operator === "<<-",
    );
    return {
      body: collected.body,
      truncated: collected.truncated,
      position: collected.endIndex + 1,
    };
  }
  // The terminator line cannot be known statically, so no line of the
  // remainder can be proven to be a command: it all becomes the body
  // instead of leaking into the analyzer as tokens.
  return {
    body: command.slice(position),
    truncated: true,
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
