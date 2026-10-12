// Shell command parsing for evidence: ssh and cat operands.

import { basename } from "node:path";
import { elementAt } from "./element-at.ts";
import { UNRESOLVED_EXPANSION } from "./git-execution-directory.ts";
import {
  sshDestinationIndex,
  sshRemoteCommandIndex,
  sshValueOption,
} from "./ssh-value-options.ts";

export function findSshIndex(tokens: ReadonlyArray<string>): number {
  return tokens.findIndex((token) => basename(token) === "ssh");
}

export interface SshInvocation {
  destination: string;
  host: string;
  user?: string;
  port?: string;
  identityFile?: string;
  strictHostKeyChecking?: string;
  remoteCommand: string;
}

/** The value options scanned around the destination; a value can be missing. */
type SshOptions = {
  [K in "port" | "identityFile" | "strictHostKeyChecking"]?:
    | SshInvocation[K]
    | undefined;
};

export function parseSsh(
  tokens: ReadonlyArray<string>,
  sshIndex: number,
): SshInvocation | undefined {
  const { destination, index, options } = scanSshArguments(tokens, sshIndex);
  if (!destination) return;
  const at = destination.lastIndexOf("@");
  const user = at > 0 ? destination.slice(0, at) : undefined;
  const host = at > 0 ? destination.slice(at + 1) : destination;
  const { port, identityFile, strictHostKeyChecking } = options;
  return {
    destination,
    host,
    ...(user === undefined ? {} : { user }),
    ...(port === undefined ? {} : { port }),
    ...(identityFile === undefined ? {} : { identityFile }),
    ...(strictHostKeyChecking === undefined ? {} : { strictHostKeyChecking }),
    remoteCommand: remoteCommand(tokens.slice(index)),
  };
}

/** The options on either side of the destination, the destination, and the
 *  index where the remote command starts. Without a destination the tokens
 *  ran out. */
function scanSshArguments(
  tokens: ReadonlyArray<string>,
  sshIndex: number,
): { destination: string | undefined; index: number; options: SshOptions } {
  const options: SshOptions = {};
  const destination = sshDestinationIndex(tokens, sshIndex + 1);
  const remote = sshRemoteCommandIndex(tokens, destination);
  recordSshOptions(tokens, sshIndex + 1, destination.index, options);
  recordSshOptions(tokens, destination.index + 1, remote, options);
  return { destination: tokens[destination.index], index: remote, options };
}

/** Records the value options in `tokens[start..end)`; a `--` closing the range is skipped. */
function recordSshOptions(
  tokens: ReadonlyArray<string>,
  start: number,
  end: number,
  options: SshOptions,
): void {
  for (let index = start; index < end; ) {
    const token = elementAt(tokens, index, "tokens");
    index +=
      token === "--" ? 1 : consumeSshOption(token, tokens[index + 1], options);
  }
}

/** Records a value-taking option and returns how many tokens it spans. As in
 *  OpenSSH, the first value obtained for a setting wins, whichever spelling
 *  set it. */
function consumeSshOption(
  token: string,
  next: string | undefined,
  options: SshOptions,
): number {
  const valued = sshValueOption(token);
  if (valued === undefined) return 1;
  const value = valued.attached ?? next;
  if (valued.option === "-i") options.identityFile ??= value;
  if (valued.option === "-p") options.port ??= value;
  if (valued.option === "-o" && value) recordConfigOption(value, options);
  return valued.attached === undefined ? 2 : 1;
}

const CONFIG_OPTION_FIELDS: ReadonlyMap<string, keyof SshOptions> = new Map([
  ["port", "port"],
  ["identityfile", "identityFile"],
  ["stricthostkeychecking", "strictHostKeyChecking"],
]);

/** An `-o` value is an ssh_config line: a case-insensitive keyword, then
 *  whitespace or an `=`. */
function recordConfigOption(line: string, options: SshOptions): void {
  const match = /^\s*([A-Za-z]+)(?:\s*=\s*|\s+)(\S.*)$/.exec(line);
  if (!match) return;
  const field = CONFIG_OPTION_FIELDS.get(match[1]?.toLowerCase() ?? "");
  if (field) options[field] ??= match[2]?.trimEnd();
}

/** The remote tokens joined, without trailing redirection-looking tokens. */
function remoteCommand(tokens: ReadonlyArray<string>): string {
  const remoteTokens = [...tokens];
  let last = remoteTokens.at(-1);
  while (last !== undefined && /^\d*(?:>|<)/.test(last)) {
    remoteTokens.pop();
    last = remoteTokens.at(-1);
  }
  return remoteTokens.join(" ");
}

export function catSource(tokens: ReadonlyArray<string>): string | undefined {
  const [head] = tokens;
  if (tokens.length < 2 || head === undefined || basename(head) !== "cat")
    return;
  const positional = tokens
    .slice(1)
    .filter((value) => value !== "--" && !value.startsWith("-"));
  const [source] = positional;
  if (positional.length !== 1 || source === undefined) return;
  if (UNRESOLVED_EXPANSION.test(source)) return;
  return source;
}
