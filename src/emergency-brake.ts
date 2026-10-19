import {
  ANALYSIS_LIMIT_REASON,
  brakeReadingsReason,
} from "./brake-readings.ts";
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
 * It deliberately does NOT expand variables, globs, command substitutions, or
 * heredocs. Those remain the reviewer's job; the brake only catches literal,
 * unambiguous `rm -rf /`-style root destruction (target resolves to `/`).
 *
 * Each reading of the command is lexed and destructured under its own
 * analysis budget (input size, tokens, depth, re-lexed text, and total
 * effective commands). When any limit is hit, the brake rejects with a
 * resource-limit reason of its own: the command was NOT proven destructive,
 * only unanalyzable within bounds, and downstream gates must not confuse the
 * two.
 *
 * The checks in brake-readings.ts run under three quote readings. The bash
 * quote reading is the lexer's own and decodes `$'…'` and `$"…"` words to the
 * values the shell gives them. The undecoded reading keeps those words as
 * written, as the default reading did before this change. The previous
 * release's quote reading ends a `$'…'` string at its first `'`. The brake
 * runs each heredoc reading under all three, so a command any earlier quote
 * reading blocked stays blocked.
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
  // Every check also runs under the undecoded and previous quote readings,
  // even without a `$'` in the text: a command string the wrappers re-lex can
  // get one from escapes. The undecoded reading keeps the brake at least as
  // strict as the previous release on every input.
  return (
    brakeReadingsReason(command, "bash") ??
    brakeReadingsReason(command, "undecoded") ??
    brakeReadingsReason(command, "previous")
  );
}
