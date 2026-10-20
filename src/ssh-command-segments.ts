// Shell command parsing for evidence: ssh and cat operands.

import { basename } from "node:path";
import { UNRESOLVED_EXPANSION } from "./git-execution-directory.ts";
import { recordSshOptions, type SshOptions } from "./ssh-option-values.ts";
import {
  sshDestinationIndex,
  sshRemoteCommandIndex,
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
