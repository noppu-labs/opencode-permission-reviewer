// OpenSSH value-taking short options, shared by the effective-command walk and ssh-command-segments.ts.

const SSH_VALUE_OPTIONS = new Set([
  "-i",
  "-l",
  "-p",
  "-o",
  "-F",
  "-J",
  "-b",
  "-c",
  "-e",
  "-m",
  "-w",
  "-W",
  "-D",
  "-L",
  "-R",
  "-I",
  "-Q",
  "-O",
  "-E",
]);

/** First value-taking option in an OpenSSH short-option cluster. The value is
 * either attached to the cluster or supplied by the following token. */
export function sshValueOption(
  token: string,
): { option: string; attached?: string } | undefined {
  if (!token.startsWith("-") || token.startsWith("--") || token.length <= 1)
    return;
  for (let position = 1; position < token.length; position += 1) {
    const option = `-${token.charAt(position)}`;
    if (!SSH_VALUE_OPTIONS.has(option)) continue;
    const attached = token.slice(position + 1);
    return attached ? { option, attached } : { option };
  }
  return;
}
