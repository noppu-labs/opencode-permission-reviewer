// The sanitized command the previous release produced for a heredoc scan. The
// emergency brake reads it as one more reading: the same operator and body
// handling as the extractor, with that release's quote, arithmetic and
// delimiter tracking. It has no substitution frames.

import { appendText, consumeBodies } from "./heredoc-bodies.ts";
import {
  type HeredocScan,
  scanHeredocOperator,
  scanNewline,
} from "./heredoc-extractor.ts";
import {
  atCommandBoundary,
  scanInsideQuotes,
  scanQuoteOrEscape,
  skipComment,
} from "./heredoc-scan-context.ts";

/** The extractor's scan state, plus the depth of the open arithmetic context
 *  the previous release tracked: `$((` and a `((` at a command position. */
type LegacyScan = HeredocScan & { depth: number };

/** The command with each heredoc body collapsed, as the previous release
 *  collapsed it. */
export function legacySanitizedCommand(command: string): string {
  const scan: LegacyScan = {
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
    readAllOperators: false,
    legacy: true,
    depth: 0,
    pending: [],
    pieces: [],
  };
  while (scan.i < command.length) scanLegacyCharacter(scan);
  if (scan.pending.length > 0) {
    appendText(scan, command.slice(scan.cursor, command.length));
    consumeBodies(scan, command.length, command.length);
    scan.cursor = command.length;
  }
  scan.out += command.slice(scan.cursor);
  return scan.out;
}

function scanLegacyCharacter(scan: LegacyScan): void {
  const c = scan.command.charAt(scan.i);
  if (scanInsideQuotes(scan, c)) return;
  if (scanQuoteOrEscape(scan, c, false)) return;
  if (skipComment(scan, c)) return;
  if (scanArithmetic(scan, c)) return;
  if (c === "\n") {
    scanNewline(scan);
    return;
  }
  if (c === "<" && scan.command[scan.i + 1] === "<") {
    scanHeredocOperator(scan);
    return;
  }
  scan.i += 1;
}

/** Inside arithmetic every character is text, `<<` and newlines included;
 *  the depth counts the parentheses that open and close it. */
function scanArithmetic(scan: LegacyScan, c: string): boolean {
  if (scan.depth > 0) {
    if (c === "(") scan.depth += 1;
    else if (c === ")") scan.depth -= 1;
    scan.i += 1;
    return true;
  }
  const { command, i } = scan;
  const opens =
    (c === "$" && command[i + 1] === "(" && command[i + 2] === "(") ||
    (c === "(" && command[i + 1] === "(" && atCommandBoundary(command, i));
  if (!opens) return false;
  scan.depth = 2;
  scan.i += c === "$" ? 3 : 2;
  return true;
}
