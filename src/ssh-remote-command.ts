// The remote command of an `ssh`, `mosh` or `autossh` invocation: what follows its options and host.

import { permuteAutosshWords } from "./autossh-permutation.ts";
import { SSH_TOOLS } from "./capability/bash-command-tables.ts";
import type { ShellToken } from "./shell-token.ts";
import { readAutosshArguments, readMoshArguments } from "./ssh-arguments.ts";
import {
  PREVIOUS_SSH_READING,
  readSshArguments,
  type SshCall,
} from "./ssh-value-options.ts";

/** The remote command of the call as one string, or `null` when nothing
 *  follows the options and host. */
function remoteText(values: readonly string[], call: SshCall): string | null {
  if (call.remoteCommand === undefined) return null;
  return values.slice(call.remoteCommand).join(" ");
}

/** autossh's remote command in the order given and, when that differs, in
 *  the order glibc's getopt permutes autossh's arguments into. */
function autosshTexts(values: readonly string[], i: number): (string | null)[] {
  const text = remoteText(values, readAutosshArguments(values, i + 1));
  const permuted = permuteAutosshWords(values, i + 1);
  const other = remoteText(permuted, readAutosshArguments(permuted, i + 1));
  return other === text ? [text] : [text, other];
}

/** The remote commands the `ssh`, `mosh` or `autossh` at `i` runs, each
 *  joined into one string, with `null` for a reading that finds none (ssh
 *  then reads a script from stdin). autossh's is read in both orders its
 *  arguments may reach ssh in. `undefined` when `base` is not one of
 *  them, or when mosh has no remote command: mosh reads no script from stdin
 *  and stays a command of its own. With `previous`, an ssh that the previous
 *  release's reading splits differently gets that reading's remote command
 *  as well. */
export function remoteCommandTexts(
  words: ShellToken[],
  i: number,
  base: string,
  previous: boolean,
): (string | null)[] | undefined {
  if (!SSH_TOOLS.has(base)) return;
  const values = words.map((t) => t.value);
  if (base === "autossh") return autosshTexts(values, i);
  const call =
    base === "mosh"
      ? readMoshArguments(values, i + 1)
      : readSshArguments(values, i + 1);
  const text = remoteText(values, call);
  if (text === null && base === "mosh") return;
  if (!previous || base !== "ssh") return [text];
  const old = remoteText(
    values,
    readSshArguments(values, i + 1, PREVIOUS_SSH_READING),
  );
  return old === text ? [text] : [text, old];
}
