// OpenSSH option scanning, shared by the effective-command walk and ssh-command-segments.ts.

/** The options of OpenSSH's getopt string (`ssh.c`) that take a value. */
const SSH_VALUE_LETTERS: ReadonlySet<string> = new Set(
  "B D E F I J L O P Q R S W b c e i l m o p w".split(" "),
);

/** How a reading of ssh's arguments finds the options' values and where it
 *  stops. */
interface SshReading {
  letters: ReadonlySet<string>;
  /** A `--` taken as an option's value ends the options, as `opt_terminated`
   *  does in `ssh.c`. */
  valueEnds: boolean;
}

const SSH_READING: SshReading = { letters: SSH_VALUE_LETTERS, valueEnds: true };

/** The previous release's reading: no `-B`, `-P` or `-S`, and only a `--`
 *  of its own ends the options. The emergency brake also judges what this
 *  reading takes for the remote command. */
export const PREVIOUS_SSH_READING: SshReading = {
  letters: new Set(
    [...SSH_VALUE_LETTERS].filter((letter) => !"BPS".includes(letter)),
  ),
  valueEnds: false,
};

/** First value-taking option in an OpenSSH short-option cluster. The value is
 * either attached to the cluster or supplied by the following token. */
export function sshValueOption(
  token: string,
  letters = SSH_VALUE_LETTERS,
): { option: string; attached?: string } | undefined {
  if (!token.startsWith("-") || token.startsWith("--") || token.length <= 1)
    return;
  for (let position = 1; position < token.length; position += 1) {
    const letter = token.charAt(position);
    if (!letters.has(letter)) continue;
    const attached = token.slice(position + 1);
    return attached
      ? { option: `-${letter}`, attached }
      : { option: `-${letter}` };
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
 *  `ssh.c`). `optionsEnded` is also set when the last option consumed a `--`
 *  as its value, which ends the options the same way. */
export function sshDestinationIndex(
  values: readonly string[],
  start: number,
  reading: SshReading = SSH_READING,
): SshOperand {
  let index = start;
  while (index < values.length) {
    const value = values[index] ?? "";
    if (value === "--") return { index: index + 1, optionsEnded: true };
    if (!value.startsWith("-") || value === "-")
      return {
        index,
        optionsEnded:
          reading.valueEnds && index > start && values[index - 1] === "--",
      };
    const valued = sshValueOption(value, reading.letters);
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
  reading: SshReading = SSH_READING,
): number {
  return afterDestination(values, destination, reading).index;
}

function afterDestination(
  values: readonly string[],
  destination: SshOperand,
  reading: SshReading,
): SshOperand {
  if (destination.optionsEnded)
    return { index: destination.index + 1, optionsEnded: true };
  return sshDestinationIndex(values, destination.index + 1, reading);
}

/** Where a program's destination and remote command are among its arguments:
 *  indexes into the words, `undefined` when there is none. */
export interface SshCall {
  destination: number | undefined;
  remoteCommand: number | undefined;
  /** A `--` ended the options before the remote command. */
  terminated: boolean;
}

/** The destination and remote command of ssh's arguments from `start`, the
 *  word after `ssh`. */
export function readSshArguments(
  words: readonly string[],
  start: number,
  reading: SshReading = SSH_READING,
): SshCall {
  const destination = sshDestinationIndex(words, start, reading);
  const remote = afterDestination(words, destination, reading);
  return {
    destination:
      destination.index < words.length ? destination.index : undefined,
    remoteCommand: remote.index < words.length ? remote.index : undefined,
    terminated: remote.optionsEnded,
  };
}
