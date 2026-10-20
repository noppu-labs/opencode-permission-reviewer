// The command a command substitution runs when the enclosing word keeps its text: a backtick form, or `$(` inside double quotes.

import { legacySanitizedCommand } from "./capability/heredoc-legacy.ts";
import { sanitizedText } from "./capability/heredoc-sanitized.ts";
import { NO_SCRIPTS } from "./capability/heredoc-scripts.ts";
import type {
  HeredocReading,
  ProbeCache,
  SubstitutionScan,
} from "./shell-lex-state.ts";
import { substitutionBodyEnd } from "./shell-substitution-end.ts";
import { expansionBody } from "./shell-substitution-expansion.ts";

/** The command text a substitution runs, and the index just past its
 *  closing `)` or backtick; or, for a `${…}` expansion, the index just past
 *  its `}`. */
export type SubstitutionBody =
  | {
      kind: "command";
      text: string;
      end: number;
      /** The commands the heredocs sanitized out of `text` run, and whether
       *  one of their bodies could not be read to the end. */
      bodyCommands: string[];
      bodyUnresolved: boolean;
      /** The text each of those heredoc bodies gives the command that reads
       *  it. */
      scripts: ReadonlyMap<string, string>;
    }
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

/** The command body ending at `end`, with its heredoc bodies collapsed
 *  under the chosen reading (or as written, `sanitize` unset), and the
 *  commands those bodies run. The previous release's reading lists none. */
function commandBody(
  text: string,
  end: number,
  reading: HeredocReading,
  sanitize: boolean,
): SubstitutionBody {
  if (!sanitize || reading === "legacy")
    return {
      kind: "command",
      text: sanitize ? legacySanitizedCommand(text) : text,
      bodyCommands: [],
      bodyUnresolved: false,
      scripts: NO_SCRIPTS,
      end,
    };
  const read = sanitizedText(text);
  return {
    kind: "command",
    text: read.text,
    bodyCommands: read.bodyCommands,
    bodyUnresolved: read.bodyUnresolved,
    scripts: read.scripts,
    end,
  };
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
  return commandBody(text, close + 1, reading, inDouble);
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
  const opener = closes === undefined ? "command" : "arith";
  const close = substitutionBodyEnd(
    command,
    start,
    opener,
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
      opener,
      reading,
      scan,
      undefined,
      probes,
    ) ===
      close - 1
  )
    return { kind: "arithmetic", end: close + 1, closes };
  const end =
    opener === "arith"
      ? substitutionBodyEnd(
          command,
          start,
          "pair",
          reading,
          scan,
          undefined,
          probes,
        )
      : close;
  return commandBody(command.slice(start, end), end + 1, reading, true);
}
