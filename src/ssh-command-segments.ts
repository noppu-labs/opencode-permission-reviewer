// Shell command parsing for evidence: ssh and cat operands.

import { basename } from "node:path";
import { elementAt } from "./element-at.ts";
import { sshValueOption } from "./ssh-value-options.ts";

function commandName(value: string): string {
  return basename(value);
}

export function findSshIndex(tokens: ReadonlyArray<string>): number {
  return tokens.findIndex((token) => commandName(token) === "ssh");
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

/** The value options scanned before the destination; a value can be missing. */
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

/** Options up to the destination, the destination, and the index where the
 *  remote command starts. Without a destination the tokens ran out. */
function scanSshArguments(
  tokens: ReadonlyArray<string>,
  sshIndex: number,
): { destination: string | undefined; index: number; options: SshOptions } {
  const options: SshOptions = {};
  let index = sshIndex + 1;
  while (index < tokens.length) {
    const token = elementAt(tokens, index, "tokens");
    if (token === "--")
      return { destination: tokens[index + 1], index: index + 2, options };
    if (!token.startsWith("-") || token === "-")
      return { destination: token, index: index + 1, options };
    index += consumeSshOption(token, tokens[index + 1], options);
  }
  return { destination: undefined, index, options };
}

/** Records a value-taking option and returns how many tokens it spans. */
function consumeSshOption(
  token: string,
  next: string | undefined,
  options: SshOptions,
): number {
  const valued = sshValueOption(token);
  if (valued === undefined) return 1;
  const value = valued.attached ?? next;
  if (valued.option === "-i") options.identityFile = value;
  if (valued.option === "-p") options.port = value;
  if (valued.option === "-o" && value) {
    const match = /^StrictHostKeyChecking=(.+)$/i.exec(value);
    if (match) options.strictHostKeyChecking = match[1];
  }
  return valued.attached === undefined ? 2 : 1;
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
  if (tokens.length < 2 || head === undefined || commandName(head) !== "cat")
    return;
  const positional = tokens
    .slice(1)
    .filter((value) => value !== "--" && !value.startsWith("-"));
  const [source] = positional;
  if (positional.length !== 1 || source === undefined) return;
  if (/[$`*?{}<>]/.test(source)) return;
  return source;
}
