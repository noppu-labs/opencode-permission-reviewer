// The quoted parts of a heredoc delimiter word: '...', $'...', $"..." and "...".

import { unescapeAnsiC } from "./ansi-c-quoting.ts";

/** The delimiter word parsed so far; `sawAny` records whether any part of
 *  it has been consumed. */
export interface WordScan {
  index: number;
  delimiter: string;
  quoted: boolean;
  resolved: boolean;
  sawAny: boolean;
}

export function scanSingleQuoted(command: string, scan: WordScan): boolean {
  const end = command.indexOf("'", scan.index + 1);
  if (end === -1) {
    scan.resolved = false;
    return false;
  }
  scan.delimiter += command.slice(scan.index + 1, end);
  scan.quoted = true;
  scan.sawAny = true;
  scan.index = end + 1;
  return true;
}

/** `$'...'` is unescaped here; for `$"..."` only the `$` is consumed, and
 *  the double-quoted part follows. */
export function scanDollarQuoted(command: string, scan: WordScan): boolean {
  scan.quoted = true;
  scan.sawAny = true;
  if (command[scan.index + 1] !== "'") {
    scan.index += 1;
    return true;
  }
  const parsed = unescapeAnsiC(command, scan.index + 2);
  if (!parsed.closed) {
    scan.resolved = false;
    return false;
  }
  scan.delimiter += parsed.text;
  scan.index = parsed.end;
  return true;
}

/** An unterminated double quote leaves `scan.index` at the end of the
 *  command. */
export function scanDoubleQuoted(command: string, scan: WordScan): boolean {
  scan.index += 1;
  let closed = false;
  while (scan.index < command.length) {
    const d = command.charAt(scan.index);
    if (d === '"') {
      closed = true;
      scan.index += 1;
      break;
    }
    if (d === "\\" && scan.index + 1 < command.length) {
      scan.delimiter += doubleQuotedEscape(command.charAt(scan.index + 1));
      scan.index += 2;
      continue;
    }
    scan.delimiter += d;
    scan.index += 1;
  }
  if (!closed) {
    scan.resolved = false;
    return false;
  }
  scan.quoted = true;
  scan.sawAny = true;
  return true;
}

/** Inside double quotes only `\$ \` \" \\` drop the backslash. */
function doubleQuotedEscape(escaped: string): string {
  return '$`"\\'.includes(escaped) ? escaped : `\\${escaped}`;
}
