// Shell command parsing for evidence: ssh and cat operands.

import { basename } from "node:path";
import { invariant } from "./invariant.ts";
import { sshValueOption } from "./ssh-value-options.ts";

function commandName(value: string): string {
  return basename(value);
}

export function findSshIndex(tokens: ReadonlyArray<string>): number {
  return tokens.findIndex((token) => commandName(token) === "ssh");
}

export function parseSsh(
  tokens: ReadonlyArray<string>,
  sshIndex: number,
):
  | {
      destination: string;
      host: string;
      user?: string;
      port?: string;
      identityFile?: string;
      strictHostKeyChecking?: string;
      remoteCommand: string;
    }
  | undefined {
  let destination: string | undefined;
  let port: string | undefined;
  let identityFile: string | undefined;
  let strictHostKeyChecking: string | undefined;
  let index = sshIndex + 1;

  while (index < tokens.length) {
    const token = tokens[index];
    invariant(token !== undefined, "tokens[index] is in bounds");
    if (token === "--") {
      index += 1;
      destination = tokens[index];
      index += 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      destination = token;
      index += 1;
      break;
    }

    const valued = sshValueOption(token);
    if (valued !== undefined) {
      const value = valued.attached ?? tokens[index + 1];
      if (valued.option === "-i") identityFile = value;
      if (valued.option === "-p") port = value;
      if (valued.option === "-o" && value) {
        const match = /^StrictHostKeyChecking=(.+)$/i.exec(value);
        if (match) strictHostKeyChecking = match[1];
      }
      index += valued.attached === undefined ? 2 : 1;
    } else {
      index += 1;
    }
  }

  if (!destination) return;
  const at = destination.lastIndexOf("@");
  const user = at > 0 ? destination.slice(0, at) : undefined;
  const host = at > 0 ? destination.slice(at + 1) : destination;
  const remoteTokens = [...tokens.slice(index)];
  let last = remoteTokens.at(-1);
  while (last !== undefined && /^\d*(?:>|<)/.test(last)) {
    remoteTokens.pop();
    last = remoteTokens.at(-1);
  }
  return {
    destination,
    host,
    ...(user === undefined ? {} : { user }),
    ...(port === undefined ? {} : { port }),
    ...(identityFile === undefined ? {} : { identityFile }),
    ...(strictHostKeyChecking === undefined ? {} : { strictHostKeyChecking }),
    remoteCommand: remoteTokens.join(" "),
  };
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
