import type { HeredocRecord } from "./capability-types.ts";
import {
  appendText,
  consumeBodies,
  type PendingLine,
} from "./heredoc-bodies.ts";
import { parseDelimiterWord } from "./heredoc-delimiter.ts";
import { innermostLimit, insideSubstitution } from "./heredoc-frame-bounds.ts";
import {
  closeBacktickFrames,
  dropSubstitutedStarts,
  enclosingSubstitution,
  readsNoBody,
} from "./heredoc-frame-starts.ts";
import {
  closingFrame,
  fallBackFromArithmetic,
  openBacktick,
  openFrame,
  type ScanContext,
  scanInsideQuotes,
  scanQuoteOrEscape,
  skipComment,
} from "./heredoc-scan-context.ts";

/*
 * Heredoc extraction.
 *
 * Runs BEFORE the shell lexer used by the capability analyzer, so heredoc
 * bodies never become tokens the analyzer walks. The motivating case is:
 *
 *   cat > /tmp/x <<'EOF'
 *   ...arbitrary content...
 *   EOF
 *   bun /tmp/x
 *
 * The extractor returns the command with each heredoc body replaced by a
 * redacted placeholder, plus structured records (delimiter, expansion flag,
 * bounded+redacted body, sha256 of the full body, output target when a `> path`
 * precedes the heredoc, dynamic flag).
 *
 * A body opened inside backticks or a `$((` substitution ends at that
 * construct's close, as in bash: the scan resumes there and walks the lines
 * after it. A closing backtick ends every construct still open inside it. A `$((` span is arithmetic only when the `)` matching its second
 * `(` is followed by `)`; otherwise it is a command substitution.
 *
 * NOTE: the capability analyzer, the emergency brake, the substitution
 * re-lexer and the display all walk the sanitized command this extractor
 * returns, so a body it collapses is hidden from them. Text left inline is
 * lexed as commands, so leaving a real body inline can hide later lines. The
 * scan therefore reads a body wherever the shell may, and the emergency brake
 * also checks the reading that collapses every operator (`readAllOperators`).
 *
 * This is a bounded static parser, not a shell executor: it never expands the
 * body, never runs anything, and marks bodies with unresolvable expansions as
 * dynamic (partial analysis).
 */

/** Result of extracting heredocs from a raw command. */
export interface HeredocExtraction {
  /** Whether a body read reached the end of input without its terminator
   *  line. Length bounding does not set it. */
  unterminated: boolean;
  /** Whether a heredoc opened inside a substitution or backticks. */
  framed: boolean;
  /** Command with heredoc bodies replaced by placeholder tokens. */
  sanitizedCommand: string;
  /** Structured heredoc records. */
  heredocs: HeredocRecord[];
  /** Whether any dynamic construct was detected inside a body. */
  hasDynamicConstructs: boolean;
}

/** Options for `extractHeredocs`. */
export interface HeredocOptions {
  /** Every `<<` outside quotes and comments opens a heredoc, and none is
   *  dropped at a same-line close. */
  readAllOperators?: boolean;
}

/**
 * Extract every heredoc in `command`, replacing each body with a placeholder
 * `<HEREDOC:sha256:xxxxxxxx>` so the downstream lexer never sees the content.
 *
 * The scan is quote-aware: `<<` inside quoted strings or comments, and the
 * here-string operator `<<<`, are not heredoc starts. Several heredocs may
 * open on one line; their bodies follow in operator order, as in bash.
 */
export function extractHeredocs(
  command: string,
  options: HeredocOptions = {},
): HeredocExtraction {
  const scan: HeredocScan = {
    command,
    heredocs: [],
    hasDynamicConstructs: false,
    unterminated: false,
    framed: false,
    out: "",
    cursor: 0,
    i: 0,
    lineStart: 0,
    quote: undefined,
    frames: [],
    backtickAt: -1,
    pending: [],
    pieces: [],
    readAllOperators: options.readAllOperators === true,
    legacy: false,
  };
  while (scan.i < command.length) scanCharacter(scan);
  if (scan.pending.length > 0) {
    appendText(scan, command.slice(scan.cursor, command.length));
    consumeBodies(scan, command.length, command.length);
    scan.cursor = command.length;
  }
  scan.out += command.slice(scan.cursor);
  return {
    unterminated: scan.unterminated,
    framed: scan.framed,
    sanitizedCommand: scan.out,
    heredocs: scan.heredocs,
    hasDynamicConstructs: scan.hasDynamicConstructs,
  };
}

/** The scanner's state. Text from `cursor` on has not been copied to `out`
 *  yet. */
export interface HeredocScan extends ScanContext, PendingLine {
  cursor: number;
  lineStart: number;
  readAllOperators: boolean;
  framed: boolean;
  /** Read the previous release's delimiter words (a carriage return ends one). */
  legacy: boolean;
}

/** Advance the scan past the character at `scan.i` (or the construct that
 *  starts there). */
function scanCharacter(scan: HeredocScan): void {
  if (closeBacktickFrames(scan)) return;
  const c = scan.command.charAt(scan.i);
  if (scanInsideQuotes(scan, c)) return;
  if (scanQuoteOrEscape(scan, c)) return;
  if (skipComment(scan, c)) return;
  if (openFrame(scan)) return;
  if (closeFrame(scan)) return;
  if (c === "\n") {
    scanNewline(scan);
    return;
  }
  if (c === "`") {
    openBacktick(scan);
    return;
  }
  if (c === "<" && scan.command[scan.i + 1] === "<") {
    scanHeredocOperator(scan);
    return;
  }
  scan.i += 1;
}

/** Close the construct ending at `scan.i`, or fall back a lone `)` out of
 *  arithmetic. A substitution or backtick that ends on the operator's own
 *  line ends no heredoc: the shell reads the close before any body line, so
 *  the starts opened inside it are dropped and their operator text stays in
 *  the command. */
function closeFrame(scan: HeredocScan): boolean {
  const frame = closingFrame(scan);
  if (frame === undefined) return fallBackFromArithmetic(scan);
  scan.frames.pop();
  if (frame.kind === "backtick") scan.backtickAt = -1;
  scan.quote = frame.quote;
  scan.i += frame.close.length;
  if (
    !scan.readAllOperators &&
    (frame.kind === "substitution" || frame.kind === "backtick")
  )
    dropSubstitutedStarts(scan, frame);
  return true;
}

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
