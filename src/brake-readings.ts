import {
  redirectionWritesBlockDevice,
  redirectTargetsBlockDevice,
} from "./brake-block-device.ts";
import { commandDestroysDevice } from "./brake-device-tools.ts";
import { joinExecCommands } from "./brake-find-exec.ts";
import {
  analyzeFind,
  type FindCommand,
  isRootFind,
} from "./brake-find-root.ts";
import { logicalLines } from "./brake-logical-lines.ts";
import { commandExportsSecret } from "./brake-network-export.ts";
import { isRootRm } from "./brake-root-rm.ts";
import type { Redirection } from "./capability/capability-types.ts";
import { extractHeredocs } from "./capability/heredoc-extractor.ts";
import { legacySanitizedCommand } from "./capability/heredoc-legacy.ts";
import {
  analyzeSegmentRedirections,
  type SegmentRedirectionsAnalysis,
} from "./shell-effective-commands.ts";
import type { HeredocReading, ShellQuoting } from "./shell-lex-state.ts";
import {
  type AnalysisBudget,
  lexSegmentsBounded,
  newAnalysisBudget,
} from "./shell-lexer.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";

/** One segment with its resolved effective commands, computed once per
 *  request and shared by every detector. */
interface AnalyzedSegment
  extends Pick<SegmentRedirectionsAnalysis, "segmentRedirections"> {
  segment: ShellSegment;
  effective: ShellToken[][];
  redirections: Redirection[][];
  finds: FindCommand[];
}

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

/** Lexes the command and resolves every segment's effective commands under
 *  one shared budget, or returns `undefined` when any limit is hit. */
function analyzeSegments(
  command: string,
  reading: HeredocReading,
  quoting: ShellQuoting,
): AnalyzedSegment[] | undefined {
  const lex = lexSegmentsBounded(command, reading, quoting);
  if (lex.truncated) return undefined;
  const budget = newAnalysisBudget(reading, quoting);
  const analyzed: AnalyzedSegment[] = [];
  for (const segment of lex.segments) {
    const analysis = analyzeSegment(segment, budget);
    if (analysis === undefined) return undefined;
    analyzed.push(analysis);
  }
  return analyzed;
}

/** Resolves one segment and the exec actions of its find commands, or
 *  returns `undefined` when any of those walks hits a limit. The commands
 *  the exec actions run join the segment's effective commands, so every
 *  detector judges them like the segment's own. */
function analyzeSegment(
  segment: ShellSegment,
  budget: AnalysisBudget,
): AnalyzedSegment | undefined {
  const analysis = analyzeSegmentRedirections(segment, budget);
  if (analysis.truncated) return undefined;
  const finds = analyzeFinds(analysis.commands, budget);
  if (finds === undefined) return undefined;
  const all = joinExecCommands([analysis, ...finds.map(({ exec }) => exec)]);
  return {
    segment,
    effective: all.commands,
    redirections: all.redirections,
    segmentRedirections: all.segmentRedirections,
    finds,
  };
}

/** The find commands among `commands` and among the commands their exec
 *  actions run, at any depth, or `undefined` when any exec walk hits a limit.
 *  The exec walks of a nested find are charged to the shared `budget` per
 *  argv token, which keeps the nested work linear in the budget. */
function analyzeFinds(
  commands: readonly ShellToken[][],
  budget: AnalysisBudget,
): FindCommand[] | undefined {
  const finds: FindCommand[] = [];
  const pending = commands.map((command) => ({ command, nested: false }));
  for (let next = pending.pop(); next; next = pending.pop()) {
    const find = analyzeFind(next.command, budget, next.nested);
    if (find?.exec.truncated) return undefined;
    if (find === undefined) continue;
    finds.push(find);
    for (const command of find.exec.commands)
      pending.push({ command, nested: true });
  }
  return finds;
}

/** The first destructive or secret-export reason among the detectors, run on
 *  one body-free reading of the command. */
function detectorReason(
  sanitizedCommand: string,
  reading: HeredocReading,
  quoting: ShellQuoting,
): string | undefined {
  const analyzed = analyzeSegments(sanitizedCommand, reading, quoting);
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
): string | undefined {
  for (const line of logicalLines(command)) {
    const reason = detectorReason(line, "default", quoting);
    if (reason !== undefined && reason !== ANALYSIS_LIMIT_REASON) return reason;
  }
}

/** The brake's checks on every reading of `command`, lexed under `quoting`.
 *  Text the scan leaves inline is lexed as commands, so a body read under one
 *  reading can hide a later line from another. The brake checks the default
 *  reading, the reading that collapses every operator, and the heredoc
 *  reading the previous release used; each distinct text is checked once. */
export function brakeReadingsReason(
  command: string,
  quoting: ShellQuoting,
): string | undefined {
  // Heredoc bodies are shell input data, not command segments. Analyze the
  // body-free form so quoted payloads cannot trigger false destructive-command
  // matches; dynamic expansions remain visible to the reviewer evidence.
  const extraction = extractHeredocs(command);
  const allOperators = extractHeredocs(command, { readAllOperators: true });
  const readings = new Set([
    extraction.sanitizedCommand,
    allOperators.sanitizedCommand,
  ]);
  for (const text of readings) {
    const reason = detectorReason(text, "default", quoting);
    if (reason !== undefined) return reason;
  }
  // The previous release's heredoc reading, its substitutions re-lexed the same way.
  const legacyReason = detectorReason(
    legacySanitizedCommand(command),
    "legacy",
    quoting,
  );
  if (legacyReason !== undefined) return legacyReason;
  // A body that never ends takes every later line with it, and a heredoc in a
  // substitution or backticks may end where the scan's reading and the
  // shell's differ. In either case the brake also checks the command as
  // written, and each of its lines on its own. Only the default reading decides
  // this: the all-operators reading opens starts the shell does not read.
  if (extraction.unterminated || extraction.framed)
    return (
      detectorReason(command, "default", quoting) ??
      linesReason(command, quoting)
    );
}
