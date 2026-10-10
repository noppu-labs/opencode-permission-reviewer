// The remote command of an `ssh` invocation: what follows its options and host.

import { elementAt } from "./element-at.ts";
import type { ShellToken } from "./shell-token.ts";
import { sshValueOption } from "./ssh-value-options.ts";

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
  let i = start;
  let hostSeen = false;
  while (i < tokens.length) {
    const t = elementAt(tokens, i, "tokens").value;
    if (t === "--") return tokens.slice(i + 1);
    if (t.startsWith("-") && t.length > 1) i += sshOptionWidth(t);
    else if (hostSeen) break;
    else {
      hostSeen = true;
      i += 1;
    }
  }
  return tokens.slice(i);
}

function sshOptionWidth(t: string): number {
  const valued = sshValueOption(t);
  return valued !== undefined && valued.attached === undefined ? 2 : 1;
}
