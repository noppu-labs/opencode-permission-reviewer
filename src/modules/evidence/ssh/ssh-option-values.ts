// The value options (port, identity file, host-key checking) read around an ssh destination.

import { elementAt } from "../../../utils/element-at.ts";
import { sshValueOption } from "./ssh-value-options.ts";

/** The value options scanned around the destination; a value can be missing. */
export type SshOptions = {
  [K in "port" | "identityFile" | "strictHostKeyChecking" | "user"]?:
    | string
    | undefined;
};

/** Records the value options in `tokens[start..end)`; a `--` closing the range is skipped. */
export function recordSshOptions(
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
  if (valued.option === "-l") options.user ??= value;
  if (valued.option === "-o" && value) recordConfigOption(value, options);
  return valued.attached === undefined ? 2 : 1;
}

const CONFIG_OPTION_FIELDS: ReadonlyMap<string, keyof SshOptions> = new Map([
  ["port", "port"],
  ["identityfile", "identityFile"],
  ["stricthostkeychecking", "strictHostKeyChecking"],
  ["user", "user"],
]);

/** An `-o` value is an ssh_config line: a case-insensitive keyword, then
 *  whitespace or an `=`. */
function recordConfigOption(line: string, options: SshOptions): void {
  const match = /^\s*([A-Za-z]+)(?:\s*=\s*|\s+)(\S.*)$/.exec(line);
  if (!match) return;
  const field = CONFIG_OPTION_FIELDS.get(match[1]?.toLowerCase() ?? "");
  if (field) options[field] ??= match[2]?.trimEnd();
}
