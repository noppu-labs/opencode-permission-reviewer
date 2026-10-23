// The heredoc redirects of a command as the display shows them: each
// operator word as typed, mapped from where the sanitized command rewrote
// it, and its body's line count. Server only.

import { parseDelimiterWord } from "../../analysis/capability/heredoc/heredoc-delimiter.ts";
import type { HeredocExtraction } from "../../analysis/capability/heredoc/heredoc-extractor.ts";
import type { HeredocRecord } from "../../analysis/capability/models/capability-types.ts";
import { type HeredocBody, heredocBodies } from "./ui-heredoc-lines.ts";
import { heredocOperators, type OperatorWord } from "./ui-heredoc-scan.ts";

/** A heredoc operator word, `start` to `end` in the sanitized command and
 *  `next` past its body placeholder there; `typed` is the word as the
 *  original command has it, and `lines` its body's line count. */
export interface HeredocRedirect extends OperatorWord {
  typed: string;
  lines: number;
}

/** Walks the sanitized command and the original side by side. They agree
 *  everywhere except the operator words and the bodies the original has
 *  after each start line. */
class Alignment {
  /** Position in the sanitized command. */
  private s = 0;
  /** Position in the original command. */
  private o = 0;
  /** Bodies passed so far; only a body whose operator was read may be. */
  private skipped = 0;
  private read = 0;

  constructor(
    private readonly command: string,
    private readonly sanitized: string,
    private readonly bodies: readonly HeredocBody[],
  ) {}

  /** Moves to `target` in the sanitized command; false when the text on the
   *  way differs from the original's. */
  advanceTo(target: number): boolean {
    while (this.s < target) {
      this.skipBodies();
      if (this.sanitized.charAt(this.s) !== this.command.charAt(this.o))
        return false;
      this.s += 1;
      this.o += 1;
    }
    this.skipBodies();
    return true;
  }

  /** Reads the operator word at the current position of the original, which
   *  must be the one `record` describes, and moves past it and `operator`. */
  typedWord(operator: OperatorWord, record: HeredocRecord): string | undefined {
    const start = this.o;
    if (!this.command.startsWith(record.operator, start)) return undefined;
    let wordStart = start + record.operator.length;
    while (/[ \t]/.test(this.command.charAt(wordStart))) wordStart += 1;
    const word = parseDelimiterWord(this.command, wordStart);
    if (!word.resolved || word.delimiter !== record.delimiter) return undefined;
    this.s = operator.next;
    this.o = word.wordEnd;
    this.read += 1;
    return this.command.slice(start, word.wordEnd);
  }

  atEnd(): boolean {
    return this.s === this.sanitized.length && this.o === this.command.length;
  }

  private skipBodies(): void {
    for (
      let body = this.bodies[this.skipped];
      body !== undefined && this.skipped < this.read && body.start === this.o;
      body = this.bodies[this.skipped]
    ) {
      this.o = body.end;
      this.skipped += 1;
    }
  }
}

/** Each heredoc redirect of `command`, in order. Undefined unless every body
 *  is verified, every operator is one the shell reads as a redirect, and the
 *  sanitized command maps back onto `command`. */
export function heredocRedirects(
  command: string,
  extraction: HeredocExtraction,
): HeredocRedirect[] | undefined {
  const bodies = heredocBodies(command, extraction);
  const operators = heredocOperators(extraction.sanitizedCommand);
  if (
    bodies === undefined ||
    operators === undefined ||
    operators.length !== bodies.length
  )
    return undefined;
  const alignment = new Alignment(command, extraction.sanitizedCommand, bodies);
  const redirects: HeredocRedirect[] = [];
  for (const [index, operator] of operators.entries()) {
    const record = extraction.heredocs[index];
    const body = bodies[index];
    if (
      record === undefined ||
      body === undefined ||
      !alignment.advanceTo(operator.start)
    )
      return undefined;
    const typed = alignment.typedWord(operator, record);
    if (typed === undefined) return undefined;
    redirects.push({ ...operator, typed, lines: body.lines });
  }
  return alignment.advanceTo(extraction.sanitizedCommand.length) &&
    alignment.atEnd()
    ? redirects
    : undefined;
}
