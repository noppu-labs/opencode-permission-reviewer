// The command a command substitution runs when the enclosing word keeps its text: a backtick form, or `$(` inside double quotes.

import { extractHeredocs } from "./capability/heredoc-extractor.ts";
import { legacySanitizedCommand } from "./capability/heredoc-legacy.ts";
import type { HeredocReading, SubstitutionScan } from "./shell-lex-state.ts";
import { substitutionBodyEnd } from "./shell-substitution-end.ts";

/** The command text a substitution runs, and the index just past its
 *  closing `)` or backtick. */
export type SubstitutionBody =
  | { kind: "command"; text: string; end: number }
  | { kind: "arithmetic"; end: number };

/**
 * An unquoted `$(` is not a substitution here: the scanner already splits at
 * its parentheses. `$((…))` is arithmetic, not a command. Heredoc bodies
 * inside double quotes reach no earlier heredoc pass, so they are replaced
 * here, the same way, before the text is lexed.
 */
export function substitutionAt(
  command: string,
  index: number,
  inDouble: boolean,
  inArithmetic: boolean,
  reading: HeredocReading = "default",
  scan: SubstitutionScan = "bash",
): SubstitutionBody | undefined {
  const c = command.charAt(index);
  if (c === "`")
    return backtickBody(command, index + 1, inDouble, reading, scan);
  if (!inDouble || c !== "$" || command[index + 1] !== "(") return undefined;
  if (inArithmetic && command[index + 2] === "(") return undefined;
  return dollarParenBody(command, index + 2, reading, scan);
}

/** The body with its heredoc bodies collapsed, under the chosen reading. */
function sanitizeBody(text: string, reading: HeredocReading): string {
  return reading === "legacy"
    ? legacySanitizedCommand(text)
    : extractHeredocs(text).sanitizedCommand;
}

/** Inside backticks a backslash escapes only `$`, a backtick and itself
 *  (and `"` inside double quotes); every other backslash stays. */
function backtickBody(
  command: string,
  start: number,
  inDouble: boolean,
  reading: HeredocReading,
  scan: SubstitutionScan,
): SubstitutionBody {
  const close = substitutionBodyEnd(command, start, "backtick", reading, scan);
  const escaped = inDouble ? /\\([$`\\"])/g : /\\([$`\\])/g;
  const text = command.slice(start, close).replace(escaped, "$1");
  return {
    kind: "command",
    text: inDouble ? sanitizeBody(text, reading) : text,
    end: close + 1,
  };
}

function dollarParenBody(
  command: string,
  start: number,
  reading: HeredocReading,
  scan: SubstitutionScan,
): SubstitutionBody {
  const close = substitutionBodyEnd(command, start, "command", reading, scan);
  if (
    command[start] === "(" &&
    substitutionBodyEnd(command, start + 1, "command", reading, scan) ===
      close - 1
  )
    return { kind: "arithmetic", end: close + 1 };
  return {
    kind: "command",
    text: sanitizeBody(command.slice(start, close), reading),
    end: close + 1,
  };
}
