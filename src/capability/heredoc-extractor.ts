import type { HeredocRecord } from "./capability-types.ts";
import {
  appendText,
  consumeBodies,
  type PendingLine,
} from "./heredoc-bodies.ts";
import type { BodyCommands } from "./heredoc-body-commands.ts";
import { closeBacktickFrames, closeFrame } from "./heredoc-frame-starts.ts";
import { scanHeredocOperator, scanNewline } from "./heredoc-operator-scan.ts";
import {
  openBacktick,
  openFrame,
  type ScanContext,
  scanInsideQuotes,
  scanQuoteOrEscape,
  skipComment,
} from "./heredoc-scan-context.ts";
import { NO_SCRIPTS } from "./heredoc-scripts.ts";

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
 * after it. A closing backtick ends every construct still open inside it.
 * A `$((` span is arithmetic only when the `)` matching its second `(` is
 * followed by `)`; otherwise it is a command substitution.
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
  /** The commands the substitutions in unquoted bodies run, in body order. */
  bodyCommands: string[];
  /** Some body has a substitution with no end, or nests past the depth the
   *  scanner reads. */
  bodyUnresolved: boolean;
  /** The text each body gives the command that reads it, by placeholder. */
  scripts: ReadonlyMap<string, string>;
}

/** Options for `extractHeredocs`. */
export interface HeredocOptions {
  /** Every `<<` outside quotes and comments opens a heredoc. Under this
   *  reading a `$(` substitution that closes on the operator's line keeps its
   *  starts; a closing backtick drops them under either reading. */
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
  // Only a `<` right before another opens a heredoc, so without one the
  // command comes back as it is.
  if (!command.includes("<<")) return unchanged(command);
  const bodies: BodyCommands = { commands: [], unresolved: false };
  const scan: HeredocScan = {
    command,
    bodies,
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
    bodyCommands: bodies.commands,
    bodyUnresolved: bodies.unresolved,
    scripts: bodies.scripts ?? NO_SCRIPTS,
  };
}

function unchanged(command: string): HeredocExtraction {
  return {
    unterminated: false,
    framed: false,
    sanitizedCommand: command,
    heredocs: [],
    hasDynamicConstructs: false,
    bodyCommands: [],
    bodyUnresolved: false,
    scripts: NO_SCRIPTS,
  };
}

/** The scanner's state. Text from `cursor` on has not been copied to `out`
 *  yet. */
export interface HeredocScan extends ScanContext, PendingLine {
  cursor: number;
  lineStart: number;
  readAllOperators: boolean;
  framed: boolean;
  /** Read the previous release's delimiter words: a carriage return ends
   *  one. */
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
