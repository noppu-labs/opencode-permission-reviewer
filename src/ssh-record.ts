// One ssh segment's evidence record: the parsed invocation, hint signals and its stdin.

import type { FileEvidence } from "./evidence-file-reader.ts";
import { commandSignals, stdinSignals } from "./evidence-signals.ts";
import type { parseSsh } from "./ssh-command-segments.ts";

export type SshInvocation = NonNullable<ReturnType<typeof parseSsh>>;

export function sshRecord(
  parsed: SshInvocation,
  preceding: string | undefined,
  stdin: FileEvidence | undefined,
  remoteCommandSha256: string | undefined,
): Record<string, unknown> {
  const analyzedStdin = stdinSignals(stdin);
  return {
    kind: "ssh",
    destination: parsed.destination,
    host: parsed.host,
    ...(parsed.user === undefined ? {} : { user: parsed.user }),
    ...(parsed.port === undefined ? {} : { port: parsed.port }),
    ...(parsed.identityFile === undefined
      ? {}
      : { identityFile: parsed.identityFile }),
    ...(parsed.strictHostKeyChecking === undefined
      ? {}
      : { strictHostKeyChecking: parsed.strictHostKeyChecking }),
    remoteCommand: parsed.remoteCommand || "<interactive or unspecified>",
    ...(remoteCommandSha256 === undefined ? {} : { remoteCommandSha256 }),
    signals: commandSignals(parsed.remoteCommand, stdin !== undefined),
    ...(analyzedStdin === undefined ? {} : { stdinSignals: analyzedStdin }),
    ...stdinField(stdin, preceding),
  };
}

function stdinField(
  stdin: FileEvidence | undefined,
  preceding: string | undefined,
): Record<string, unknown> {
  if (stdin !== undefined) return { stdin };
  return preceding === "|"
    ? {
        stdin: {
          status: "unresolved",
          reason: "pipeline producer is not one regular cat file",
        },
      }
    : {};
}
