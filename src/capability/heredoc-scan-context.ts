// The shell context the heredoc scan tracks: quoting, escapes, comments and arithmetic, where `<<` opens no heredoc.

/** The part of the heredoc scan state that tracks where in the shell
 *  syntax `i` is. */
export interface ScanContext {
  command: string;
  i: number;
  inSingle: boolean;
  inDouble: boolean;
  /** Depth of open arithmetic context: `$(( ... ))` anywhere, and
   *  `(( ... ))` at a command position. While open, `<<` is a shift
   *  operator, not a heredoc: treating `1 << 2` as a heredoc would swallow
   *  the rest of the command behind an unterminated "delimiter". */
  arithmeticDepth: number;
}

export function scanInsideQuotes(scan: ScanContext, c: string): boolean {
  if (scan.inSingle) {
    if (c === "'") scan.inSingle = false;
    scan.i += 1;
    return true;
  }
  if (scan.inDouble) {
    if (c === "\\") scan.i += 1;
    else if (c === '"') scan.inDouble = false;
    scan.i += 1;
    return true;
  }
  return false;
}

export function scanQuoteOrEscape(scan: ScanContext, c: string): boolean {
  if (c === "'") scan.inSingle = true;
  else if (c === '"') scan.inDouble = true;
  else if (c === "\\" && scan.i + 1 < scan.command.length) scan.i += 1;
  else return false;
  scan.i += 1;
  return true;
}

/** A comment hides the rest of its line from the shell, so it can hide no
 *  heredoc either. Stops at the newline. */
export function skipComment(scan: ScanContext, c: string): boolean {
  const { command } = scan;
  if (c !== "#" || !atCommandBoundary(command, scan.i)) return false;
  while (scan.i < command.length && command[scan.i] !== "\n") scan.i += 1;
  return true;
}

/** Whether the character at `i` starts a word: first in the command, or after whitespace or `;&|()`. */
function atCommandBoundary(command: string, i: number): boolean {
  return i === 0 || /[\s;&|()]/.test(command.charAt(i - 1));
}

export function scanArithmetic(scan: ScanContext, c: string): boolean {
  if (scan.arithmeticDepth > 0) {
    if (c === "(") scan.arithmeticDepth += 1;
    else if (c === ")") scan.arithmeticDepth -= 1;
    scan.i += 1;
    return true;
  }
  if (!opensArithmetic(scan.command, scan.i, c)) return false;
  scan.arithmeticDepth = 2;
  scan.i += c === "$" ? 3 : 2;
  return true;
}

function opensArithmetic(command: string, i: number, c: string): boolean {
  return (
    (c === "$" && command[i + 1] === "(" && command[i + 2] === "(") ||
    (c === "(" && command[i + 1] === "(" && atCommandBoundary(command, i))
  );
}
