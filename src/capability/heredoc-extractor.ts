import { elementAt } from "../element-at.ts";
import type { HeredocRecord } from "./capability-types.ts";
import {
  appendText,
  consumeBodies,
  type PendingLine,
} from "./heredoc-bodies.ts";
import { parseDelimiterWord } from "./heredoc-delimiter.ts";
import { enclosingSubstitution, readsNoBody } from "./heredoc-frame-starts.ts";
import {
  closingFrame,
  type Frame,
  fallBackFromArithmetic,
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
 * NOTE: the capability analyzer, the emergency brake, the substitution
 * re-lexer and the display all walk the sanitized command this extractor
 * returns, so a body it collapses is hidden from them, and text it leaves
 * inline may read as commands. That cuts both ways, which is why the scan
 * only opens a heredoc where the shell reads a body.
 *
 * This is a bounded static parser, not a shell executor: it never expands the
 * body, never runs anything, and marks bodies with unresolvable expansions as
 * dynamic (partial analysis).
 */

/** Result of extracting heredocs from a raw command. */
export interface HeredocExtraction {
  /** Command with heredoc bodies replaced by placeholder tokens. */
  sanitizedCommand: string;
  /** Structured heredoc records. */
  heredocs: HeredocRecord[];
  /** Whether any dynamic construct was detected inside a body. */
  hasDynamicConstructs: boolean;
}

/** Options for `extractHeredocs`. */
export interface HeredocOptions {
  /** Read every `<<` outside quotes and comments as a heredoc start, whatever
   *  the frames around it, and keep every start when a substitution closes on
   *  its line. This is the reading that collapses every candidate operator. */
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
    out: "",
    cursor: 0,
    i: 0,
    lineStart: 0,
    quote: undefined,
    frames: [],
    pending: [],
    pieces: [],
    readAllOperators: options.readAllOperators === true,
  };
  while (scan.i < command.length) scanCharacter(scan);
  if (scan.pending.length > 0) {
    appendText(scan, command.slice(scan.cursor, command.length));
    consumeBodies(scan, command.length, command.length);
    scan.cursor = command.length;
  }
  scan.out += command.slice(scan.cursor);
  return {
    sanitizedCommand: scan.out,
    heredocs: scan.heredocs,
    hasDynamicConstructs: scan.hasDynamicConstructs,
  };
}

/** The scanner's state. Text from `cursor` on has not been copied to `out`
 *  yet. */
interface HeredocScan extends ScanContext, PendingLine {
  cursor: number;
  lineStart: number;
  readAllOperators: boolean;
}

/** Advance the scan past the character at `scan.i` (or the construct that
 *  starts there). */
function scanCharacter(scan: HeredocScan): void {
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
    scanBacktick(scan);
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
  scan.quote = frame.quote;
  scan.i += frame.close.length;
  if (
    !scan.readAllOperators &&
    (frame.kind === "substitution" || frame.kind === "backtick")
  )
    dropSubstitutedStarts(scan, frame);
  return true;
}

/** A backtick opens a substitution frame, read like `$(`: a heredoc operator
 *  inside it reads a body while the backtick stays open across the newline. */
function scanBacktick(scan: HeredocScan): void {
  scan.frames.push({ close: "`", quote: scan.quote, kind: "backtick" });
  scan.i += 1;
}

function scanNewline(scan: HeredocScan): void {
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
  scan.lineStart = resume;
}

function scanHeredocOperator(scan: HeredocScan): void {
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
  const word = parseDelimiterWord(command, j, frame?.kind === "backtick");
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
  });
  scan.pieces.push({ pendingIndex: scan.pending.length - 1 });
  scan.cursor = word.wordEnd;
  scan.i = word.wordEnd;
}

/** Drop the starts opened inside `frame`, whose close the shell reads on
 *  the operator's own line: no body follows them, so each operator and its
 *  delimiter word return to the command as text. */
function dropSubstitutedStarts(scan: HeredocScan, frame: Frame): void {
  let first = scan.pending.length;
  while (first > 0 && scan.pending[first - 1]?.frame === frame) first -= 1;
  const dropped = scan.pending.splice(first);
  if (dropped.length === 0) return;
  scan.pieces = scan.pieces.map((piece) => {
    if (!("pendingIndex" in piece) || piece.pendingIndex < first) return piece;
    const start = elementAt(dropped, piece.pendingIndex - first, "dropped");
    return { text: scan.command.slice(start.opStart, start.wordEnd) };
  });
  if (scan.pending.length === 0) {
    // No start remains, so no placeholder is owed: the pieces hold the
    // line's own text again, and the scan passes text through from here.
    for (const piece of scan.pieces) {
      if ("text" in piece) scan.out += piece.text;
    }
    scan.out += scan.command.slice(scan.cursor, scan.i);
    scan.cursor = scan.i;
    scan.pieces = [];
  }
}
