import type { BodyCommands } from "../capability/heredoc/heredoc-body-commands.ts";
import type { HeredocReading, ShellQuoting } from "../shell/shell-lex-state.ts";
import {
  type AnalyzedSegment,
  analyzeSegments,
} from "./brake-analyzed-segments.ts";
import {
  redirectionWritesBlockDevice,
  redirectTargetsBlockDevice,
} from "./brake-block-device.ts";
import { commandDestroysDevice } from "./brake-device-tools.ts";
import { isRootFind } from "./brake-find-root.ts";
import { heredocTexts } from "./brake-heredoc-texts.ts";
import { logicalLines } from "./brake-logical-lines.ts";
import { commandExportsSecret } from "./brake-network-export.ts";
import { isRootRm } from "./brake-root-rm.ts";

const ROOT_DESTRUCTION_REGEX = [
  // Fork bomb. (Block-device formatting/overwrite and rm/find destruction are
  // handled by the lexer-based detectors below so that `echo "mkfs …"` and
  // other non-executable mentions do not trip the brake.)
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

const ROOT_DESTRUCTION_REASON =
  "Emergency brake: command contains unmistakable broad system destruction.";
const SECRET_EXPORT_REASON =
  "Emergency brake: command appears to export credential material through a network utility.";
export const ANALYSIS_LIMIT_REASON =
  "Emergency brake: command exceeded the static analysis budget (input size, token count, or command-string expansion). Split the command into smaller steps and retry. This is a resource limit, not a detected destruction.";

function isRmRootDestruction(analyzed: AnalyzedSegment[]): boolean {
  return analyzed.some(({ effective }) => effective.some(isRootRm));
}

function isFindRootDestruction(analyzed: AnalyzedSegment[]): boolean {
  return analyzed.some(({ finds }) => finds.some(isRootFind));
}

function isDeviceDestruction(analyzed: AnalyzedSegment[]): boolean {
  return analyzed.some(
    ({ segment, effective, redirections, segmentRedirections }) =>
      redirectTargetsBlockDevice(segment.tokens) ||
      segmentRedirections.some(redirectionWritesBlockDevice) ||
      effective.some((command, commandIndex) =>
        commandDestroysDevice(command, redirections[commandIndex] ?? []),
      ),
  );
}

function isObviousSecretExport(analyzed: AnalyzedSegment[]): boolean {
  return analyzed.some(({ effective, redirections }) =>
    effective.some((command, commandIndex) =>
      commandExportsSecret(command, redirections[commandIndex] ?? []),
    ),
  );
}

/** The first destructive or secret-export reason among the detectors, run on
 *  one body-free reading of the command. */
function detectorReason(
  sanitizedCommand: string,
  reading: HeredocReading,
  quoting: ShellQuoting,
  bodies: BodyCommands | undefined,
): string | undefined {
  const analyzed = analyzeSegments(sanitizedCommand, reading, quoting, bodies);
  if (analyzed === undefined) return ANALYSIS_LIMIT_REASON;

  if (isRmRootDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (isFindRootDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (isDeviceDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (ROOT_DESTRUCTION_REGEX.some((pattern) => pattern.test(sanitizedCommand)))
    return ROOT_DESTRUCTION_REASON;
  if (isObviousSecretExport(analyzed)) return SECRET_EXPORT_REASON;
}

/** The first line of `command` whose detectors block on their own. A line
 *  that exceeds the analysis budget alone is skipped: the whole command's
 *  limit was already checked by the caller. */
function linesReason(
  command: string,
  quoting: ShellQuoting,
  bodies: BodyCommands | undefined,
): string | undefined {
  for (const line of logicalLines(command)) {
    const reason = detectorReason(line, "default", quoting, bodies);
    if (reason !== undefined && reason !== ANALYSIS_LIMIT_REASON) return reason;
  }
}

/** The brake's checks on every reading of `command`, lexed under `quoting`.
 *  Text the scan leaves inline is lexed as commands, so a body read under one
 *  reading can hide a later line from another. The brake checks the default
 *  reading, the reading that collapses every operator, and the heredoc
 *  reading the previous release used; each distinct text is checked once.
 *  The commands that heredoc bodies inside substitutions and command strings
 *  run are added to `bodies`, when given. */
export function brakeReadingsReason(
  command: string,
  quoting: ShellQuoting,
  bodies?: BodyCommands,
): string | undefined {
  // Heredoc bodies are shell input data, not command segments. Analyze the
  // body-free form so quoted payloads cannot trigger false destructive-command
  // matches; dynamic expansions remain visible to the reviewer evidence.
  const { extraction, allOperators, legacy } = heredocTexts(command);
  const readings = new Set([extraction.sanitizedCommand, allOperators]);
  for (const text of readings) {
    const reason = detectorReason(text, "default", quoting, bodies);
    if (reason !== undefined) return reason;
  }
  // The previous release's heredoc reading, its substitutions re-lexed the same way.
  const legacyReason = readsLikeDefault(legacy, readings)
    ? undefined
    : detectorReason(legacy, "legacy", quoting, bodies);
  if (legacyReason !== undefined) return legacyReason;
  // A body that never ends takes every later line with it, and a heredoc in a
  // substitution or backticks may end where the scan's reading and the
  // shell's differ. In either case the brake also checks the command as
  // written, and each of its lines on its own. Only the default reading decides
  // this: the all-operators reading opens starts the shell does not read.
  if (extraction.unterminated || extraction.framed)
    return (
      detectorReason(command, "default", quoting, bodies) ??
      linesReason(command, quoting, bodies)
    );
}

/** Whether the previous release's heredoc reading of `text` is one the
 *  default reading already checked. The two read only heredocs apart, and a
 *  text with no `<` holds none; with no backslash either, no escape in it can
 *  make one in a command string read from it. */
function readsLikeDefault(text: string, checked: ReadonlySet<string>): boolean {
  return checked.has(text) && !text.includes("<") && !text.includes("\\");
}
