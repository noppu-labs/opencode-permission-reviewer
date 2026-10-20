// The remote command of an `ssh`, `mosh` or `autossh` invocation: what follows its options and host.

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
function remoteText(
  words: readonly ShellToken[],
  call: SshCall,
): string | null {
  if (call.remoteCommand === undefined) return null;
  return words
    .slice(call.remoteCommand)
    .map((t) => t.value)
    .join(" ");
}

function readCall(
  words: readonly string[],
  base: string,
  start: number,
): SshCall {
  if (base === "mosh") return readMoshArguments(words, start);
  if (base === "autossh") return readAutosshArguments(words, start);
  return readSshArguments(words, start);
}

/** The remote commands the `ssh`, `mosh` or `autossh` at `i` runs, each
 *  joined into one string, with `null` for a reading that finds none (ssh
 *  then reads a script from stdin). `undefined` when `base` is not one of
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
  const text = remoteText(words, readCall(values, base, i + 1));
  if (text === null && base === "mosh") return;
  if (!previous || base !== "ssh") return [text];
  const old = remoteText(
    words,
    readSshArguments(values, i + 1, PREVIOUS_SSH_READING),
  );
  return old === text ? [text] : [text, old];
}
