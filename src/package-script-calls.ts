// Which manifest scripts a command segment asks a package manager to run,
// unless a wrapper moves the call to another host, root or directory.

import { basename } from "node:path";
import {
  invocation,
  MANAGERS,
  type ScriptInvocation,
} from "./package-script-invocation.ts";
import { effectiveCommands } from "./shell-effective-commands.ts";

const REMOTE_OR_PRIVILEGED = [
  "ssh",
  "chroot",
  "docker",
  "podman",
  "kubectl",
  "nsenter",
  "sudo",
  "su",
  "runuser",
  "systemd-run",
];

export function scriptCalls(tokens: string[]): ScriptInvocation[] {
  const managerIndex = tokens.findIndex((token) =>
    MANAGERS.has(basename(token)),
  );
  const prefix = managerIndex < 0 ? tokens : tokens.slice(0, managerIndex);
  if (prefix.some((token) => REMOTE_OR_PRIVILEGED.includes(basename(token))))
    return [];
  const redirected = prefix.some(
    (token) => token === "-C" || token.startsWith("--chdir"),
  );
  const commands = effectiveCommands({
    tokens: tokens.map((value) => ({ raw: value, value })),
  }).map((command) => command.map((token) => token.value));
  const changesDirectory =
    redirected ||
    commands.some((command) =>
      ["cd", "pushd", "popd"].includes(command[0] ?? ""),
    );
  return commands.flatMap((command) => {
    const call = invocation(command);
    return call
      ? [
          {
            ...call,
            ...(changesDirectory
              ? {
                  unresolved: "wrapped script working directory is unresolved",
                }
              : {}),
          },
        ]
      : [];
  });
}
