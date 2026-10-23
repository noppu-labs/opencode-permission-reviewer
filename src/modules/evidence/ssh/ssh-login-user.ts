// The login user of an ssh call, in the order OpenSSH's `ssh.c` sets it.

import { elementAt } from "../../../utils/element-at.ts";
import { sshDestinationHost } from "./ssh-destination.ts";
import { recordSshOptions, type SshOptions } from "./ssh-option-values.ts";
import { readSshArguments } from "./ssh-value-options.ts";

/** The user of ssh's arguments from `start`, the word after `ssh`: the first
 *  one set by `-l` or `-o User=` before the destination, the destination's
 *  `user@` or URI user, then `-l` or `-o User=` after the destination. A
 *  destination `ssh` rejects as a URI sets no user, and ends the reading.
 *  A `User` in an `-F` file stays unknown. */
export function sshLoginUser(
  words: readonly string[],
  start: number,
): string | undefined {
  const { destination, remoteCommand } = readSshArguments(words, start);
  if (destination === undefined) return;
  const options: SshOptions = {};
  recordSshOptions(words, start, destination, options);
  const word = elementAt(words, destination, "words");
  const parts = sshDestinationHost(word);
  if (word.startsWith("ssh://") && parts.host === word) return options.user;
  options.user ??= parts.user;
  recordSshOptions(
    words,
    destination + 1,
    remoteCommand ?? words.length,
    options,
  );
  return options.user;
}
