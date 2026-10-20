import {
  type BodyBudget,
  bodyCommandsReason,
  newBodyBudget,
} from "./brake-body-commands.ts";
import { heredocTexts } from "./brake-heredoc-texts.ts";
import {
  ANALYSIS_LIMIT_REASON,
  brakeReadingsReason,
} from "./brake-readings.ts";
import {
  type BodyCommands,
  keepBodyCommands,
} from "./capability/heredoc-body-commands.ts";
import { withScanBudget } from "./capability/heredoc-scan-budget.ts";
import { keepBodyScripts } from "./capability/heredoc-scripts.ts";
import { reviewedCommand } from "./reviewed-command.ts";
import { MAX_ANALYSIS_INPUT_CHARS } from "./shell-lexer.ts";
import type { PermissionRequest } from "./types.ts";

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
 * It deliberately does NOT expand variables or globs. Those remain the
 * reviewer's job; the brake only catches literal, unambiguous `rm -rf /`-style
 * root destruction (target resolves to `/`). The commands that the
 * substitutions of an unquoted heredoc body run are the exception: bash runs
 * them, so each is judged as a command of its own, to MAX_BODY_DEPTH levels of
 * nested bodies. A body the scan cannot read to its end, or more body
 * commands than one request's budget, gives the analysis limit. Such a check
 * only adds blocks after the checks above allow.
 *
 * Each reading of the command is lexed and destructured under its own
 * analysis budget (input size, tokens, depth, re-lexed text, and total
 * effective commands). When any limit is hit, the brake rejects with a
 * resource-limit reason of its own: the command was NOT proven destructive,
 * only unanalyzable within bounds, and downstream gates must not confuse the
 * two.
 *
 * The checks in brake-readings.ts run under four quote readings. The first
 * is the lexer's own bash reading in its finder form: it decodes `$'…'` and
 * `$"…"` words to the values the shell gives them, and steps over a
 * substitution body as one unit, keeping the end the end-finder gives even
 * where the plain bash reading reads a heredoc in a double parenthesis the
 * previous way.
 * The rescan reading decodes quotes the same way but scans a substitution
 * body's text in place, as the release before that step did. The undecoded
 * reading keeps those words as written, as the default reading did before
 * this change. The previous release's quote reading ends a `$'…'` string at
 * its first `'`. The brake runs each heredoc reading under all four, so a
 * command any of them blocks stays blocked.
 */

export function emergencyBrakeReason(
  request: PermissionRequest,
): string | undefined {
  if (request.permission !== "bash") return;
  const command = reviewedCommand(request);

  // Resource limits come first and are their own outcome: an input the static
  // analysis cannot finish is rejected for THAT reason, before any lexing or
  // detector runs, and is never described as detected destruction.
  if (command.length > MAX_ANALYSIS_INPUT_CHARS) return ANALYSIS_LIMIT_REASON;
  return withScanBudget(command.length, () =>
    commandReason(command, 0, newBodyBudget()),
  );
}

/** The reason the brake gives for `command`, a command at `depth`: the
 *  readings checks first, then the commands its heredoc bodies run, each
 *  judged here at depth + 1 under the request's one `budget`. */
function commandReason(
  command: string,
  depth: number,
  budget: BodyBudget,
): string | undefined {
  const bodies: BodyCommands = { commands: [], unresolved: false };
  const { extraction } = heredocTexts(command);
  keepBodyCommands(bodies, extraction.bodyCommands, extraction.bodyUnresolved);
  keepBodyScripts(bodies, extraction.scripts);
  const reason = readingsReason(command, bodies);
  if (reason !== undefined) return reason;
  return bodyCommandsReason(
    bodies.commands,
    bodies.unresolved,
    depth + 1,
    (body, level) => commandReason(body, level, budget),
    budget,
  );
}

/** Every check also runs under the rescan, undecoded and previous quote
 *  readings, even without a `$'` in the text: a command string the wrappers
 *  re-lex can get one from escapes. The rescan reading keeps the brake at
 *  least as strict as the release before the substitution step, and the
 *  undecoded reading as strict as the previous release, on every input. */
function readingsReason(
  command: string,
  bodies: BodyCommands,
): string | undefined {
  return (
    brakeReadingsReason(command, "finder", bodies) ??
    brakeReadingsReason(command, "rescan", bodies) ??
    brakeReadingsReason(command, "undecoded", bodies) ??
    brakeReadingsReason(command, "previous", bodies)
  );
}
