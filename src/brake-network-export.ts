import { commandName } from "./brake-arguments.ts";
import type { Redirection } from "./capability/capability-types.ts";
import type { ShellToken } from "./shell-token.ts";

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

/**
 * Obvious credential export through a network utility. Detected structurally —
 * the executable itself must be the network tool — so a quoted mention inside
 * unrelated text (`echo "curl api_key"`, docs, commit messages) does not trip
 * the brake, exactly like the destruction detectors. Wrapper peeling
 * (`sh -c`, `ssh host …`, `sudo …`) still reaches the real executable.
 */
export function commandExportsSecret(
  command: readonly ShellToken[],
  redirections: readonly Redirection[],
): boolean {
  const base = commandName(command);
  if (base === undefined || !SECRET_EXPORT_UTILITIES.has(base)) return false;
  const args = [
    ...command.slice(1).map((token) => token.value),
    ...redirections
      .filter((redirection) => redirection.operator.includes("<"))
      .map((redirection) => redirection.target),
  ].join(" ");
  return SECRET_EXPORT_TARGETS.some((pattern) => pattern.test(args));
}
