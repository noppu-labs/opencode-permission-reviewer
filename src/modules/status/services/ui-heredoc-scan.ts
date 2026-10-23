// Where the heredoc operators of a sanitized command sit, found by a scan
// that tracks quoting and nesting, so a body is collapsed only for an
// operator the shell reads as a redirect. Server only.

import type { FrameSpec } from "../../analysis/capability/heredoc/heredoc-frame-links.ts";
import {
  OPENERS,
  type Quote,
} from "../../analysis/capability/heredoc/heredoc-scan-context.ts";

/** An operator and its delimiter word in the sanitized command (`start` to
 *  `end`), and `next`, past the body placeholder that follows it. */
export interface OperatorWord {
  start: number;
  end: number;
  next: number;
}

const PLACEHOLDER = /<HEREDOC:sha256:[0-9a-f]{12}>/g;
/** An operator as the extractor writes it: `<<` or `<<-`, the delimiter bare
 *  or single-quoted, then a space and the body placeholder. */
const OPERATOR =
  /^(<<-?(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|'(?:[^']|'\\'')*')) <HEREDOC:sha256:[0-9a-f]{12}>/;
/** What may precede a `#` that starts a comment. */
const WORD_BREAK = /[ \t\n;&|()<>]/;

class OperatorScan {
  readonly operators: OperatorWord[] = [];
  private index = 0;
  private quote: Quote;
  private readonly frames: FrameSpec[] = [];
  /** Operators on the current line, with the frames open at each. */
  private pending: number[] = [];
  /** Set by a construct the scan cannot follow: no operator may come after
   *  it. */
  private unsure = false;
  failed = false;

  constructor(private readonly text: string) {}

  run(): void {
    while (this.index < this.text.length && !this.failed) this.step();
  }

  private at(prefix: string): boolean {
    return this.text.startsWith(prefix, this.index);
  }

  private step(): void {
    const c = this.text.charAt(this.index);
    if (this.quote === "'") this.inSingle(c);
    else if (this.quote === "$'") this.inAnsi(c);
    else if (this.quote === '"') this.inDouble(c);
    else this.unquoted(c);
  }

  private inSingle(c: string): void {
    if (c === "'") this.quote = undefined;
    this.index += 1;
  }

  private inAnsi(c: string): void {
    if (c === "'") this.quote = undefined;
    this.index += c === "\\" ? 2 : 1;
  }

  private inDouble(c: string): void {
    if (c === '"') this.quote = undefined;
    else if (c === "`") this.unsure = true;
    else if (c === "$" && this.open()) return;
    this.index += c === "\\" ? 2 : 1;
  }

  private unquoted(c: string): void {
    if (this.quoteStart(c) || this.open() || this.closeFrame(c)) return;
    if (c === "<" && this.at("<<")) {
      this.operator();
      return;
    }
    if (c === "#" && this.startsWord()) {
      const lineEnd = this.text.indexOf("\n", this.index);
      this.index = lineEnd === -1 ? this.text.length : lineEnd;
      return;
    }
    if (c === "`") this.unsure = true;
    if (c === "\n") this.pending = [];
    this.index += c === "\\" ? 2 : 1;
  }

  private quoteStart(c: string): boolean {
    const quote: Quote = this.at("$'")
      ? "$'"
      : c === "'" || c === '"'
        ? c
        : undefined;
    if (quote === undefined) return false;
    this.quote = quote;
    this.index += quote.length;
    return true;
  }

  private startsWord(): boolean {
    return (
      this.index === 0 || WORD_BREAK.test(this.text.charAt(this.index - 1))
    );
  }

  private open(): boolean {
    const opener = OPENERS.find(([text]) => this.at(text));
    if (opener === undefined) return false;
    const [text, close, kind] = opener;
    this.frames.push({ close, quote: this.quote, kind });
    this.quote = undefined;
    this.index += text.length;
    return true;
  }

  private closeFrame(c: string): boolean {
    const frame = this.frames.at(-1);
    if (frame === undefined || !frame.close.startsWith(c)) return false;
    if (!this.at(frame.close)) {
      // A single `)` inside `((`: the scan cannot tell the two readings apart.
      this.unsure = true;
      return false;
    }
    this.frames.pop();
    this.quote = frame.quote;
    this.index += frame.close.length;
    if (
      frame.kind === "substitution" &&
      this.pending.some((depth: number): boolean => depth > this.frames.length)
    )
      this.failed = true;
    return true;
  }

  private operator(): void {
    const match = OPERATOR.exec(this.text.slice(this.index));
    if (match === null) {
      this.index += this.at("<<<") ? 3 : 2;
      return;
    }
    if (
      this.unsure ||
      this.frames.some(
        (frame: FrameSpec): boolean => frame.kind === "expansion",
      )
    ) {
      this.failed = true;
      return;
    }
    const start = this.index;
    this.operators.push({
      start,
      end: start + (match[1]?.length ?? 0),
      next: start + match[0].length,
    });
    this.pending.push(this.frames.length);
    this.index += match[0].length;
  }
}

/** Each heredoc operator of `sanitized`, in order. Undefined unless every
 *  body placeholder follows an operator the shell reads as a redirect, whose
 *  body comes from the lines after its own. */
export function heredocOperators(
  sanitized: string,
): OperatorWord[] | undefined {
  const scan = new OperatorScan(sanitized);
  scan.run();
  const placeholders = Array.from(sanitized.matchAll(PLACEHOLDER)).length;
  return scan.failed || scan.operators.length !== placeholders
    ? undefined
    : scan.operators;
}
