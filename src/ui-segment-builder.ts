// Splits only at top-level separators: text inside a parenthesised group or a
// `$( … )` stays in its segment.

import type { ShellSegment } from "./shell-token.ts";
import type { HeredocRedirect } from "./ui-heredoc-redirects.ts";
import type { ActionSegment } from "./ui-protocol.ts";
import {
  locateSeparator,
  locateToken,
  onlySkipped,
  type SourceSpan,
  touchesOperator,
} from "./ui-raw-source.ts";
import { boundedHeadTail } from "./ui-text-elide.ts";

/** Longest text one segment keeps; a longer one keeps its head and tail. */
const MAX_SEGMENT_CHARS = 200;
const SPLITTERS: ReadonlySet<string> = new Set(["|", "||", "&&", ";", "&"]);
/** A heredoc body placeholder from `extractHeredocs`, as a token of its own. */
const HEREDOC_TOKEN = /^<HEREDOC:sha256:[0-9a-f]{12}>$/;

/** A trailing `;`, typed or the command's last newline, ends nothing, so it
 *  is not shown. */
function withoutTrailingSemicolon(segments: ActionSegment[]): ActionSegment[] {
  const last = segments.at(-1);
  if (last?.separator !== ";") return segments;
  const { separator: _newline, ...rest } = last;
  return [...segments.slice(0, -1), rest];
}

export class SegmentBuilder {
  private readonly segments: ActionSegment[] = [];
  private text = "";
  private lines: number | undefined;
  /** Where the last located item ends in the source. */
  private end = 0;
  /** Where the search for the next item starts. */
  private cursor = 0;
  private depth = 0;
  private heredocs = 0;
  /** Set when the segments would not reconstruct the command: an item is
   *  missing from the source, text between items is more than the shell
   *  skips, or the display would change a separator. */
  private misread = false;

  /** `source`: the command the segments were lexed from, heredoc bodies
   *  already replaced by placeholders. `redirects`: its heredoc operators,
   *  in placeholder order. */
  constructor(
    private readonly source: string,
    private readonly redirects: readonly HeredocRedirect[],
  ) {}

  /** `previousEnd` ended the segment before this one, so a separator the
   *  lexer dropped with an empty segment (`(a) | b`) is recovered from
   *  `precededBy`. */
  add(segment: ShellSegment, previousEnd: string | undefined): void {
    const before = segment.precededBy;
    if (before !== undefined && before !== previousEnd && SPLITTERS.has(before))
      this.separator(before);
    for (const token of segment.tokens) this.token(token.raw);
    if (segment.endedBy === "(" || segment.endedBy === ")")
      this.paren(segment.endedBy);
    else if (segment.endedBy !== undefined) this.separator(segment.endedBy);
  }

  /** Undefined on a misread, or when a heredoc placeholder was not a token
   *  of its own, so its line count cannot be placed. */
  finish(): ActionSegment[] | undefined {
    this.close(undefined);
    if (
      !onlySkipped(this.source, this.cursor, this.source.length, true) ||
      this.misread ||
      this.heredocs !== this.redirects.length
    )
      return undefined;
    return withoutTrailingSemicolon(this.segments);
  }

  private located(span: SourceSpan | undefined): SourceSpan | undefined {
    const between = this.text === "" && this.lines === undefined;
    if (
      span === undefined ||
      !onlySkipped(this.source, this.cursor, span.start, between)
    ) {
      this.misread = true;
      return undefined;
    }
    this.cursor = span.next;
    return span;
  }

  private token(raw: string): void {
    const span = this.located(locateToken(this.source, raw, this.cursor));
    if (span === undefined) return;
    const redirect = this.redirects[this.heredocs];
    if (HEREDOC_TOKEN.test(raw)) this.heredoc(span, redirect);
    else if (redirect?.end === span.end && redirect.start >= span.start)
      this.word(
        `${this.source.slice(span.start, redirect.start)}${redirect.typed}`,
        span,
      );
    else this.word(this.source.slice(span.start, span.end), span);
  }

  /** A body placeholder, which must follow its operator word directly. */
  private heredoc(
    span: SourceSpan,
    redirect: HeredocRedirect | undefined,
  ): void {
    if (
      redirect === undefined ||
      this.end !== redirect.end ||
      span.end !== redirect.next
    ) {
      this.misread = true;
      return;
    }
    this.end = span.end;
    this.lines = (this.lines ?? 0) + redirect.lines;
    this.heredocs += 1;
  }

  private paren(paren: "(" | ")"): void {
    const span = this.located(locateSeparator(this.source, paren, this.cursor));
    if (span !== undefined) this.word(paren, span);
    this.depth = paren === "(" ? this.depth + 1 : Math.max(0, this.depth - 1);
  }

  private separator(separator: string): void {
    const span = this.located(
      locateSeparator(this.source, separator, this.cursor),
    );
    if (span === undefined) return;
    if (touchesOperator(this.source, span)) this.misread = true;
    if (this.depth > 0) {
      // A line break after `(` or an operator separates nothing.
      if (span.start < span.end || !/[(|&;]$/.test(this.text))
        this.word(separator, span);
      return;
    }
    // Only a line break may close an empty segment (after `|` or `&&`); any
    // other separator would be dropped from the display. A `;` is shown
    // against the text before it.
    if (
      (this.text === "" &&
        this.lines === undefined &&
        span.start !== span.end) ||
      (separator === ";" && /[<>|&;]$/.test(this.text))
    )
      this.misread = true;
    this.close(separator);
  }

  /** Appends `word`, with no space when it touches the previous item in the
   *  source or is a line break shown as `;`. */
  private word(word: string, span: SourceSpan): void {
    const attach =
      this.text === "" || span.start === this.end || span.start === span.end;
    this.text = attach ? `${this.text}${word}` : `${this.text} ${word}`;
    this.end = span.end;
  }

  private close(separator: string | undefined): void {
    if (this.text === "" && this.lines === undefined) return;
    this.segments.push({
      text: boundedHeadTail(this.text, MAX_SEGMENT_CHARS),
      ...(separator === undefined ? {} : { separator }),
      ...(this.lines === undefined ? {} : { heredocLines: this.lines }),
    });
    this.text = "";
    this.lines = undefined;
  }
}
