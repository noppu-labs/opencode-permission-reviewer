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
import { commandExportsSecret } from "./brake-network-export.ts";
import { isRootRm } from "./brake-root-rm.ts";
import type { Redirection } from "./capability/capability-types.ts";
import { extractHeredocs } from "./capability/heredoc-extractor.ts";
import { reviewedCommand } from "./reviewed-command.ts";
import {
  analyzeSegmentRedirections,
  type SegmentRedirectionsAnalysis,
} from "./shell-effective-commands.ts";
import {
  type AnalysisBudget,
  lexSegmentsBounded,
  MAX_ANALYSIS_INPUT_CHARS,
  newAnalysisBudget,
} from "./shell-lexer.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";
import type { PermissionRequest } from "./types.ts";

/** One segment with its resolved effective commands, computed once per
 *  request and shared by every detector. */
interface AnalyzedSegment
  extends Pick<SegmentRedirectionsAnalysis, "segmentRedirections"> {
  segment: ShellSegment;
  effective: ShellToken[][];
  redirections: Redirection[][];
  finds: FindCommand[];
}

/*
 * Deterministic emergency brake.
 *
 * Inspects a pending bash command for *unmistakable* broad destruction or
 * obvious credential export and rejects it before any model call. Everything
 * ambiguous is left to the reviewer.
 *
 * Root destruction is detected with a quote-aware, wrapper-aware shell lexer
 * (see shell-scanner.ts and shell-effective-commands.ts) so that privilege
 * prefixes (`sudo`, `doas`, `env`, `command`, …), absolute binary paths
 * (`/bin/rm`, `/usr/bin/rm`), combined or separated flags (`-rf`, `-r -f`,
 * `--recursive --force`), end-of-options (`--`), and command-string forms
 * (`sh -c '…'`, `su -c …`, `ssh host …`, `watch …`, `busybox rm …`,
 * `chroot root …`) are peeled before judging the executable.
 *
 * It deliberately does NOT expand variables, globs, command substitutions, or
 * heredocs. Those remain the reviewer's job; the brake only catches literal,
 * unambiguous `rm -rf /`-style root destruction (target resolves to `/`).
 *
 * The whole command, including the commands that find exec actions run, is
 * lexed and destructured exactly once per request under a shared analysis
 * budget (input size, tokens, depth, re-lexed text, and total effective
 * commands). When any limit is hit, the brake rejects with a resource-limit
 * reason of its own: the command was NOT proven destructive, only
 * unanalyzable within bounds, and downstream gates must not confuse the two.
 */

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
const ANALYSIS_LIMIT_REASON =
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
function analyzeSegments(command: string): AnalyzedSegment[] | undefined {
  const lex = lexSegmentsBounded(command);
  if (lex.truncated) return undefined;
  const budget = newAnalysisBudget();
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
function detectorReason(sanitizedCommand: string): string | undefined {
  const analyzed = analyzeSegments(sanitizedCommand);
  if (analyzed === undefined) return ANALYSIS_LIMIT_REASON;

  if (isRmRootDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (isFindRootDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (isDeviceDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (ROOT_DESTRUCTION_REGEX.some((pattern) => pattern.test(sanitizedCommand)))
    return ROOT_DESTRUCTION_REASON;
  if (isObviousSecretExport(analyzed)) return SECRET_EXPORT_REASON;
}

export function emergencyBrakeReason(
  request: PermissionRequest,
): string | undefined {
  if (request.permission !== "bash") return;
  const command = reviewedCommand(request);

  // Resource limits come first and are their own outcome: an input the static
  // analysis cannot finish is rejected for THAT reason, before any lexing or
  // detector runs, and is never described as detected destruction.
  if (command.length > MAX_ANALYSIS_INPUT_CHARS) return ANALYSIS_LIMIT_REASON;
  // Heredoc bodies are shell input data, not command segments. Analyze the
  // body-free form so quoted payloads cannot trigger false destructive-command
  // matches; dynamic expansions remain visible to the reviewer evidence.
  // Text the scan leaves inline is lexed as commands, so a body read under the
  // default reading and one read under the all-operators reading can each
  // hide a later line from the other. The brake checks both readings.
  const sanitizedCommand = extractHeredocs(command).sanitizedCommand;
  const reason = detectorReason(sanitizedCommand);
  if (reason !== undefined) return reason;
  const allOperators = extractHeredocs(command, {
    readAllOperators: true,
  }).sanitizedCommand;
  if (allOperators === sanitizedCommand) return;
  return detectorReason(allOperators);
}
