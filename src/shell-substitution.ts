// The command a command substitution runs when the enclosing word keeps its text: a backtick form, or `$(` inside double quotes.

import { extractHeredocs } from "./capability/heredoc-extractor.ts";
import { legacySanitizedCommand } from "./capability/heredoc-legacy.ts";
import type {
  HeredocReading,
  ProbeCache,
  SubstitutionScan,
} from "./shell-lex-state.ts";
import { substitutionBodyEnd } from "./shell-substitution-end.ts";

/** The command text a substitution runs, and the index just past its
 *  closing `)` or backtick; or, for a `${…}` expansion, the index just past
 *  its `}`. */
export type SubstitutionBody =
  | { kind: "command"; text: string; end: number }
  | { kind: "arithmetic"; end: number; closes: FrameCloses | undefined }
  | { kind: "expansion"; end: number; closes: FrameCloses };

/** The index each frame inside a substitution closed at, by the index it
 *  began at: the `(` or `$` that opened it. */
export type FrameCloses = Map<number, number>;

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
  probes?: ProbeCache,
): SubstitutionBody | undefined {
  const c = command.charAt(index);
  if (c === "`")
    return backtickBody(command, index + 1, inDouble, reading, scan);
  if (inDouble && c === "$" && command[index + 1] === "{")
    return expansionBody(command, index, reading, scan, probes);
  if (!inDouble || c !== "$" || command[index + 1] !== "(") return undefined;
  if (inArithmetic && command[index + 2] === "(") return undefined;
  return dollarParenBody(command, index + 2, reading, scan, probes);
}

/** A `${…}` in double quotes holds quoted text and substitutions of its own,
 *  so a `}` or `"` inside it does not end the word. Only the shell's reading
 *  scans it. A `$` right after another `$` is no start: versions of the shell
 *  disagree on where such a word ends, so the previous reading stays. */
function expansionBody(
  command: string,
  index: number,
  reading: HeredocReading,
  scan: SubstitutionScan,
  probes: ProbeCache | undefined,
): SubstitutionBody | undefined {
  if (scan !== "bash" || endsDollarPair(command, index)) return undefined;
  const closes: FrameCloses = new Map();
  const close = substitutionBodyEnd(
    command,
    index + 2,
    "brace",
    reading,
    scan,
    closes,
    probes,
  );
  return { kind: "expansion", end: close + 1, closes };
}

/** Whether the `$` at `index` is the second of a `$$` pair: an odd number
 *  of unescaped `$` end right before it. */
function endsDollarPair(command: string, index: number): boolean {
  let dollars = 0;
  while (command[index - 1 - dollars] === "$") dollars += 1;
  let slashes = 0;
  while (command[index - 1 - dollars - slashes] === "\\") slashes += 1;
  return (dollars - (slashes % 2)) % 2 === 1;
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
  probes: ProbeCache | undefined,
): SubstitutionBody {
  const isPair = command[start] === "(";
  const closes: FrameCloses | undefined =
    isPair && scan === "bash" ? new Map() : undefined;
  const close = substitutionBodyEnd(
    command,
    start,
    "command",
    reading,
    scan,
    closes,
    probes,
  );
  if (
    isPair &&
    substitutionBodyEnd(
      command,
      start + 1,
      "command",
      reading,
      scan,
      undefined,
      probes,
    ) ===
      close - 1
  )
    return { kind: "arithmetic", end: close + 1, closes };
  return {
    kind: "command",
    text: sanitizeBody(command.slice(start, close), reading),
    end: close + 1,
  };
}
