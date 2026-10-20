// How mosh and autossh read their arguments before they hand a remote command to ssh.

import { readSshArguments, type SshCall } from "./ssh-value-options.ts";

/** The options of autossh's getopt string (`autossh.c` OPTION_STRING) that
 *  take a value. */
const AUTOSSH_VALUE_LETTERS: ReadonlySet<string> = new Set(
  "M b c e i l m o p w D E F I L O Q R S W".split(" "),
);

/** Drops autossh's own `-f` from an option word, as `strip_arg` does: the
 *  scan stops at an option that takes a value, and one removal leaves the
 *  character that shifted into its place unexamined. A bare `-` is dropped. */
function stripDaemonFlag(word: string): string {
  if (!word.startsWith("-") || word.length === 1) return word;
  let kept = word;
  for (
    let at = 0;
    at < kept.length && !AUTOSSH_VALUE_LETTERS.has(kept.charAt(at));
    at += 1
  )
    if (kept.charAt(at) === "f") kept = kept.slice(0, at) + kept.slice(at + 1);
  return kept === "-" ? "" : kept;
}

/** What autossh does with a word itself, before the first `--`: that `--` is
 *  its own, and `-M` takes a monitoring port, as the next word unless
 *  attached. */
function autosshOwn(
  word: string,
  stopped: boolean,
): "stop" | "port" | "port-value" | undefined {
  if (stopped) return;
  if (word.startsWith("--")) return "stop";
  if (word.startsWith("-M")) return word === "-M" ? "port-value" : "port";
}

/** The arguments autossh passes on to ssh, with where each one was: it
 *  drops `-M` and its port until the first `--`, drops that first `--`
 *  word, strips `-f` and skips what becomes empty. */
function autosshToSshArguments(
  words: readonly string[],
  start: number,
): { kept: string[]; origin: number[] } {
  const kept: string[] = [];
  const origin: number[] = [];
  let stopped = false;
  for (let index = start; index < words.length; index += 1) {
    const word = words[index] ?? "";
    const own = autosshOwn(word, stopped);
    if (own === "stop") stopped = true;
    if (own === "port-value") index += 1;
    if (own !== undefined) continue;
    const argument = stripDaemonFlag(word);
    if (argument === "") continue;
    kept.push(argument);
    origin.push(index);
  }
  return { kept, origin };
}

/** The destination and remote command of autossh's arguments from `start`:
 *  the ssh reading of what autossh hands to ssh. */
export function readAutosshArguments(
  words: readonly string[],
  start: number,
): SshCall {
  const { kept, origin } = autosshToSshArguments(words, start);
  const call = readSshArguments(kept, 0);
  const at = (index: number | undefined): number | undefined =>
    index === undefined ? undefined : origin[index];
  return {
    destination: at(call.destination),
    remoteCommand: at(call.remoteCommand),
    terminated: call.terminated,
  };
}

const MOSH_VALUE_OPTIONS: readonly string[] = [
  "client",
  "server",
  "predict",
  "port",
  "family",
  "p",
  "ssh",
  "bind-server",
  "experimental-remote-ip",
];

const MOSH_FLAG_OPTIONS: readonly string[] = [
  "predict-overwrite",
  "o",
  "a",
  "n",
  "4",
  "6",
  "ssh-pty",
  "init",
  "local",
  "help",
  "version",
  "fake-proxy",
];

/** Option names `Getopt::Long` accepts for `mosh.pl`'s `GetOptions` table:
 *  the negatable ones also as `no` and `no-` forms. */
const MOSH_NAMES: readonly string[] = [
  ...MOSH_VALUE_OPTIONS,
  ...MOSH_FLAG_OPTIONS,
  ...["predict-overwrite", "ssh-pty", "init", "fake-proxy"].flatMap((name) => [
    `no${name}`,
    `no-${name}`,
  ]),
];

/** Whether the option word takes the next word as its value: its name,
 *  matched ignoring case, is a value option of `mosh.pl` exactly or by the
 *  only name it abbreviates, and it carries no `=value`. */
function moshTakesValue(word: string): boolean {
  const [name = "", ...attached] = word.replace(/^--?/, "").split("=");
  if (attached.length > 0) return false;
  const lower = name.toLowerCase();
  const matches = MOSH_NAMES.includes(lower)
    ? [lower]
    : MOSH_NAMES.filter((candidate) => candidate.startsWith(lower));
  return matches.length === 1 && MOSH_VALUE_OPTIONS.includes(matches[0] ?? "");
}

type MoshWord = "operand" | "end" | "value" | "flag";

function classifyMoshWord(word: string, terminated: boolean): MoshWord {
  if (terminated || !word.startsWith("-") || word === "-") return "operand";
  if (word === "--") return "end";
  return moshTakesValue(word) ? "value" : "flag";
}

/** The destination and remote command of mosh's arguments from `start`.
 *  `Getopt::Long` takes its options anywhere among the words, so the
 *  destination is the first operand and the remote command starts at the next
 *  one; a `--` makes every word after it an operand. */
export function readMoshArguments(
  words: readonly string[],
  start: number,
): SshCall {
  let destination: number | undefined;
  let terminated = false;
  for (let index = start; index < words.length; index += 1) {
    const kind = classifyMoshWord(words[index] ?? "", terminated);
    if (kind === "end") terminated = true;
    else if (kind === "value") index += 1;
    else if (kind === "operand") {
      if (destination !== undefined)
        return { destination, remoteCommand: index, terminated };
      destination = index;
    }
  }
  return { destination, remoteCommand: undefined, terminated };
}
