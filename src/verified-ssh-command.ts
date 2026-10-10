// The verified ssh script command: the one shell form that pipes a local script to ssh behind a
// remote hash check, rendered and recognized exactly.

import { sourceCommand } from "./evidence/source-command.ts";
import type { PermissionRequest } from "./types.ts";

export interface VerifiedScriptCommand {
  path: string;
  destination: string;
  port?: number;
  sha256: string;
  shell: "bash" | "sh";
}

/** This exact shell form binds the locally reviewed bytes to the remote ones.
 * The remote hash check runs before the interpreter, even if the file changes
 * between permission review and execution. */
export function renderVerifiedSshScriptCommand(
  input: VerifiedScriptCommand,
): string {
  const remote =
    "set -eu; f=$(mktemp /tmp/reviewer-script.XXXXXXXX); " +
    "cleanup(){ rm -f -- $f; }; trap cleanup EXIT; cat >$f; " +
    `sum=$(sha256sum $f); test \${sum%% *} = ${input.sha256}; ${input.shell} $f`;
  return `cat -- ${input.path} | ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5${input.port === undefined ? "" : ` -p ${input.port}`} ${input.destination} '${remote}'`;
}

export function parseVerifiedSshScriptCommand(
  request: PermissionRequest,
): VerifiedScriptCommand | undefined {
  if (request.permission !== "bash") return;
  const command = sourceCommand(request).trim();
  const parts = verifiedCommandParts(command);
  if (!parts) return;
  const digest = /\b[a-f0-9]{64}\b/.exec(parts.remote)?.[0];
  const shell = /; (bash|sh) \$f$/.exec(parts.remote)?.[1] as
    | "bash"
    | "sh"
    | undefined;
  if (!digest || !shell) return;
  const parsed = {
    path: parts.path,
    destination: parts.destination,
    ...(parts.port === undefined ? {} : { port: parts.port }),
    sha256: digest,
    shell,
  };
  return renderVerifiedSshScriptCommand(parsed) === command
    ? parsed
    : undefined;
}

/** The path, port, destination and remote script of a command in the
 *  canonical shape, with a valid port and a destination that is not an
 *  option. */
function verifiedCommandParts(command: string):
  | {
      path: string;
      port: number | undefined;
      destination: string;
      remote: string;
    }
  | undefined {
  const match =
    /^cat -- ([A-Za-z0-9_./-]+) \| ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5(?: -p ([0-9]{1,5}))? ([A-Za-z0-9_.@-]+) '(.+)'$/.exec(
      command,
    );
  if (!match) return;
  // Groups 1, 3 and 4 always match; only the port group is optional.
  const [, path, portText, destination, remote] = match;
  if (
    path === undefined ||
    destination === undefined ||
    remote === undefined ||
    destination.startsWith("-")
  )
    return;
  const port = portText === undefined ? undefined : Number(portText);
  if (port !== undefined && (port < 1 || port > 65535)) return;
  return { path, port, destination, remote };
}
