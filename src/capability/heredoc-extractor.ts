import type { HeredocRecord } from "./capability-types.ts";
import {
  appendText,
  consumeBodies,
  type PendingLine,
} from "./heredoc-bodies.ts";
import { parseDelimiterWord } from "./heredoc-delimiter.ts";
import {
  type ScanContext,
  scanArithmetic,
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
 * NOTE: this protects the capability analyzer and evidence providers only.
 * The emergency brake operates on the RAW command independently and does NOT
 * use this extractor — heredoc bodies may still appear as tokens the brake
 * sees. This is a known conservative limitation (the brake may false-positive
 * on destructive text inside a heredoc body, but never false-negative).
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

/**
 * Extract every heredoc in `command`, replacing each body with a placeholder
 * `<HEREDOC:sha256:xxxxxxxx>` so the downstream lexer never sees the content.
 *
 * The scan is quote-aware: `<<` inside quoted strings or comments, and the
 * here-string operator `<<<`, are not heredoc starts. Several heredocs may
 * open on one line; their bodies follow in operator order, as in bash.
 */
export function extractHeredocs(command: string): HeredocExtraction {
  const scan: HeredocScan = {
    command,
    heredocs: [],
    hasDynamicConstructs: false,
    out: "",
    cursor: 0,
    i: 0,
    lineStart: 0,
    inSingle: false,
    inDouble: false,
    arithmeticDepth: 0,
    pending: [],
    pieces: [],
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
}

/** Advance the scan past the character at `scan.i` (or the construct that
 *  starts there). */
function scanCharacter(scan: HeredocScan): void {
  const { command } = scan;
  const c = command.charAt(scan.i);
  if (scanInsideQuotes(scan, c)) return;
  if (scanQuoteOrEscape(scan, c)) return;
  if (skipComment(scan, c)) return;
  if (scanArithmetic(scan, c)) return;
  if (c === "\n") {
    scanNewline(scan);
    return;
  }
  if (c === "<" && command[scan.i + 1] === "<") {
    scanHeredocOperator(scan);
    return;
  }
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
  while (j < command.length && (command[j] === " " || command[j] === "\t"))
    j += 1;
  const word = parseDelimiterWord(command, j);
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
  });
  scan.pieces.push({ pendingIndex: scan.pending.length - 1 });
  scan.cursor = word.wordEnd;
  scan.i = word.wordEnd;
}
