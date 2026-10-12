// OpenSSH option scanning, shared by the effective-command walk and ssh-command-segments.ts.

const SSH_VALUE_OPTIONS = new Set([
  "-i",
  "-l",
  "-p",
  "-o",
  "-F",
  "-J",
  "-b",
  "-c",
  "-e",
  "-m",
  "-w",
  "-W",
  "-D",
  "-L",
  "-R",
  "-I",
  "-Q",
  "-O",
  "-E",
]);

/** First value-taking option in an OpenSSH short-option cluster. The value is
 * either attached to the cluster or supplied by the following token. */
export function sshValueOption(
  token: string,
): { option: string; attached?: string } | undefined {
  if (!token.startsWith("-") || token.startsWith("--") || token.length <= 1)
    return;
  for (let position = 1; position < token.length; position += 1) {
    const option = `-${token.charAt(position)}`;
    if (!SSH_VALUE_OPTIONS.has(option)) continue;
    const attached = token.slice(position + 1);
    return attached ? { option, attached } : { option };
  }
  return;
}

/** Where ssh's next operand is among `values` from `start`. */
export interface SshOperand {
  /** The operand's index, or `values.length` when there is none. */
  index: number;
  /** A `--` ended the options before the operand. */
  optionsEnded: boolean;
}

/** The destination among ssh's arguments from `start`: the first operand
 *  after the options, or the token after a `--` that ends them (OpenSSH
 *  `ssh.c`). `index` is `values.length` when there is none. */
export function sshDestinationIndex(
  values: readonly string[],
  start: number,
): SshOperand {
  let index = start;
  while (index < values.length) {
    const value = values[index] ?? "";
    if (value === "--") return { index: index + 1, optionsEnded: true };
    if (!value.startsWith("-") || value === "-")
      return { index, optionsEnded: false };
    const valued = sshValueOption(value);
    index += valued !== undefined && valued.attached === undefined ? 2 : 1;
  }
  return { index: values.length, optionsEnded: false };
}

/** Where the remote command starts after `destination`. Unless a `--` already
 *  ended the options, ssh parses options again after the destination, up to
 *  the first operand or through a `--` (OpenSSH `ssh.c`). */
export function sshRemoteCommandIndex(
  values: readonly string[],
  destination: SshOperand,
): number {
  if (destination.optionsEnded) return destination.index + 1;
  return sshDestinationIndex(values, destination.index + 1).index;
}
