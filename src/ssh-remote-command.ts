// The remote command of an `ssh` invocation: what follows its options and host.

import type { ShellToken } from "./shell-token.ts";
import {
  sshDestinationIndex,
  sshRemoteCommandIndex,
} from "./ssh-value-options.ts";

/** The remote command `ssh` at `i` runs, joined into one string, or `null`
 *  when nothing follows the options and host. */
export function sshRemoteCommand(
  words: ShellToken[],
  i: number,
): string | null {
  const rest = consumeSshRemote(words, i + 1);
  return rest.length > 0 ? rest.map((t) => t.value).join(" ") : null;
}

/** Consume ssh options + host and return the remaining remote-command tokens. */
function consumeSshRemote(tokens: ShellToken[], start: number): ShellToken[] {
  const values = tokens.map((t) => t.value);
  const destination = sshDestinationIndex(values, start);
  return tokens.slice(sshRemoteCommandIndex(values, destination));
}
