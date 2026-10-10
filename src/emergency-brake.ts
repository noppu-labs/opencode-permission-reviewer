import { commandName, splitArguments } from "./brake-arguments.ts";
import { redirectTargetsBlockDevice } from "./brake-block-device.ts";
import { commandDestroysDevice } from "./brake-device-tools.ts";
import { isRootFind } from "./brake-find-root.ts";
import { hasRmFlags } from "./brake-rm-flags.ts";
import { targetsRoot } from "./brake-root-target.ts";
import type { Redirection } from "./capability/capability-types.ts";
import { extractHeredocs } from "./capability/heredoc-extractor.ts";
import { analyzeEffectiveCommands } from "./shell-effective-commands.ts";
import {
  lexSegmentsBounded,
  MAX_ANALYSIS_INPUT_CHARS,
  newAnalysisBudget,
  shellBasename,
} from "./shell-lexer.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";
import type { PermissionRequest } from "./types.ts";

/** One segment with its resolved effective commands, computed once per
 *  request and shared by every detector. */
interface AnalyzedSegment {
  segment: ShellSegment;
  effective: ShellToken[][];
  redirections: Redirection[][];
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
 * (`sh -c '…'`, `su -c …`, `ssh host …`, `busybox rm …`, `chroot root …`)
 * are peeled before judging the executable.
 *
 * It deliberately does NOT expand variables, globs, command substitutions, or
 * heredocs. Those remain the reviewer's job; the brake only catches literal,
 * unambiguous `rm -rf /`-style root destruction (target resolves to `/`).
 *
 * The whole command is lexed and destructured exactly once per request under
 * a shared analysis budget (input size, tokens, depth, re-lexed text, and
 * total effective commands). When any limit is hit, the brake rejects with a
 * resource-limit reason of its own: the command was NOT proven destructive,
 * only unanalyzable within bounds, and downstream gates must not confuse the
 * two.
 */

const ROOT_DESTRUCTION_REGEX = [
  // Fork bomb. (Block-device formatting/overwrite and rm/find destruction are
  // handled by the lexer-based detectors below so that `echo "mkfs …"` and
  // other non-executable mentions do not trip the brake.)
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

const SECRET_EXPORT_UTILITIES = new Set([
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "socat",
]);

const SECRET_EXPORT_TARGETS = [
  /(?:\.ssh\/(?:id_|authorized_keys)|\.aws\/credentials|\.config\/gh\/hosts\.yml)/i,
  /(?:api[_-]?key|access[_-]?token|private[_-]?key|session[_-]?cookie)/i,
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

function isRootRm(command: ShellToken[]): boolean {
  if (commandName(command) !== "rm") return false;
  const { recursive, force } = hasRmFlags(command);
  return (
    recursive && force && splitArguments(command).operands.some(targetsRoot)
  );
}

function isFindRootDestruction(analyzed: AnalyzedSegment[]): boolean {
  return analyzed.some(({ effective }) => effective.some(isRootFind));
}

function isDeviceDestruction(analyzed: AnalyzedSegment[]): boolean {
  return analyzed.some(
    ({ segment, effective, redirections }) =>
      redirectTargetsBlockDevice(segment.tokens) ||
      effective.some((command, commandIndex) =>
        commandDestroysDevice(command, redirections[commandIndex] ?? []),
      ),
  );
}

/**
 * Obvious credential export through a network utility. Detected structurally —
 * the executable itself must be the network tool — so a quoted mention inside
 * unrelated text (`echo "curl api_key"`, docs, commit messages) does not trip
 * the brake, exactly like the destruction detectors above. Wrapper peeling
 * (`sh -c`, `ssh host …`, `sudo …`) still reaches the real executable.
 */
function isObviousSecretExport(analyzed: AnalyzedSegment[]): boolean {
  for (const { effective, redirections } of analyzed) {
    for (const [commandIndex, tokens] of effective.entries()) {
      const first = tokens[0];
      if (first === undefined) continue;
      if (!SECRET_EXPORT_UTILITIES.has(shellBasename(first.value))) continue;
      const args = [
        ...tokens.slice(1).map((token) => token.value),
        ...(redirections[commandIndex] ?? [])
          .filter((redirection) => redirection.operator.includes("<"))
          .map((redirection) => redirection.target),
      ].join(" ");
      if (SECRET_EXPORT_TARGETS.some((pattern) => pattern.test(args)))
        return true;
    }
  }
  return false;
}

export function emergencyBrakeReason(
  request: PermissionRequest,
): string | undefined {
  if (request.permission !== "bash") return;
  const command =
    typeof request.metadata.command === "string"
      ? request.metadata.command
      : request.patterns
          .filter((pattern) => typeof pattern === "string")
          .join("\n");

  // Resource limits come first and are their own outcome: an input the static
  // analysis cannot finish is rejected for THAT reason, before any lexing or
  // detector runs, and is never described as detected destruction. The whole
  // command is lexed and resolved exactly once here; detectors share the
  // result instead of re-analyzing the same text once per detector.
  if (command.length > MAX_ANALYSIS_INPUT_CHARS) return ANALYSIS_LIMIT_REASON;
  // Heredoc bodies are shell input data, not command segments. Analyze the
  // body-free form so quoted payloads cannot trigger false destructive-command
  // matches; dynamic expansions remain visible to the reviewer evidence.
  const { sanitizedCommand } = extractHeredocs(command);
  const lex = lexSegmentsBounded(sanitizedCommand);
  if (lex.truncated) return ANALYSIS_LIMIT_REASON;
  const budget = newAnalysisBudget();
  const analyzed: AnalyzedSegment[] = [];
  for (const segment of lex.segments) {
    const analysis = analyzeEffectiveCommands(segment, budget);
    if (analysis.truncated) return ANALYSIS_LIMIT_REASON;
    analyzed.push({
      segment,
      effective: analysis.commands,
      redirections: analysis.redirections,
    });
  }

  if (isRmRootDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (isFindRootDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (isDeviceDestruction(analyzed)) return ROOT_DESTRUCTION_REASON;
  if (ROOT_DESTRUCTION_REGEX.some((pattern) => pattern.test(sanitizedCommand)))
    return ROOT_DESTRUCTION_REASON;
  if (isObviousSecretExport(analyzed)) return SECRET_EXPORT_REASON;
}
