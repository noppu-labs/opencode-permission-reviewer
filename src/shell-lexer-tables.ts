// Wrapper, option and keyword tables the effective-command walk peels commands with.

export const TRANSPARENT_WRAPPERS = new Set([
  "sudo",
  "doas",
  "pkexec",
  "env",
  "command",
  "nice",
  "nohup",
  "time",
  "stdbuf",
  "ionice",
  "fakeroot",
  "setsid",
  "setpriv",
  "unshare",
  "run0",
  "systemd-run",
  "strace",
  "ltrace",
  "watch",
  "xargs",
  "timeout",
  "exec",
]);

export const ENV_VALUE_OPTIONS = new Set([
  "-u",
  "--unset",
  "-S",
  "--split-string",
  "-C",
  "--chdir",
]);

/**
 * Wrapper short options that consume the next token as their value. Only flags
 * documented to take an argument are listed; pure flags (sudo -S/-A, unshare
 * --mount/--pid/…, run0 --mkdir/--no-ask-password) are intentionally absent so
 * the real executable that follows them is not swallowed by mistake.
 */
export const VALUE_OPTIONS: Record<string, Set<string>> = {
  sudo: new Set([
    "-u",
    "--user",
    "-g",
    "--group",
    "-C",
    "-p",
    "--prompt",
    "-R",
    "-T",
    "-U",
    "-D",
    "--chdir",
    "-r",
    "-t",
  ]),
  doas: new Set(["-u", "--user", "-a"]),
  pkexec: new Set(["--user", "--session"]),
  env: ENV_VALUE_OPTIONS,
  nice: new Set(["-n", "--adjustment"]),
  time: new Set(["-o", "--output", "-f"]),
  ionice: new Set(["-c", "-n"]),
  setpriv: new Set([
    "--ruid",
    "--euid",
    "--rgid",
    "--egid",
    "--reuid",
    "--regid",
    "--inh-caps",
    "--bounding-set",
    "--ambient-caps",
    "--groups",
    "--securebits",
    "--pdeathsig",
    "--selinux-label",
    "--apparmor-profile",
  ]),
  command: new Set(),
  nohup: new Set(),
  // stdbuf's -i/-o/-e take the buffer TYPE either attached (`-oL`) or as the
  // next token; both forms skip exactly one value.
  stdbuf: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
  fakeroot: new Set(),
  setsid: new Set(),
  unshare: new Set([
    "--propagation",
    "--setgroups",
    "-R",
    "--root",
    "-w",
    "--wd",
    "-S",
    "--setuid",
    "-G",
    "--setgid",
    "--monotonic",
    "--boottime",
  ]),
  run0: new Set(["--unit", "--service", "--slice", "--setenv", "--chdir"]),
  // systemd-run mostly uses = forms (self-contained tokens); the flags listed
  // here also accept a separate value token that must not be mistaken for the
  // wrapped command.
  "systemd-run": new Set([
    "-p",
    "-E",
    "-H",
    "--host",
    "-M",
    "--property",
    "-u",
    "--unit",
    "--description",
    "--slice",
    "--uid",
    "--gid",
    "--nice",
    "--expand-environment",
    "--service-type",
    "--working-directory",
    "--setenv",
    "--machine",
    "--job-mode",
    "--on-active",
    "--on-boot",
    "--on-startup",
    "--on-calendar",
    "--on-unit-active",
    "--on-unit-inactive",
    "--timer-property",
    "--path-property",
    "--socket-property",
  ]),
  // strace/ltrace: -o/-e/-s take a separate value; their long forms are
  // = only. Tracing without a command (`strace -p PID`) has nothing to peel
  // after the PID is consumed.
  strace: new Set(["-o", "-e", "-s", "-a", "-b", "-p", "-u"]),
  ltrace: new Set(["-o", "-e", "-s", "-a", "-l", "-u"]),
  // watch's interval and equexit flags consume separate values; its pure flags
  // (-d, -g, -t, -b, -c, -e, …) stay absent like the other wrappers above.
  watch: new Set(["-n", "--interval", "-q", "--equexit"]),
  // xargs value-taking options with a separate argument: without these the
  // generic peel would mistake the option's argument for the command. Pure
  // flags (-0, -r, -t, …) stay absent, as do options with optional arguments
  // (-e, -l, --replace), where skipping a following token could swallow the
  // real executable instead.
  xargs: new Set([
    "-I",
    "-a",
    "-d",
    "-E",
    "-n",
    "-P",
    "-s",
    "-L",
    "--arg-file",
    "--delimiter",
    "--max-args",
    "--max-chars",
    "--max-procs",
    "--max-lines",
    "--process-slot-var",
  ]),
  // timeout value options; the DURATION operand itself is skipped by dedicated
  // handling in walk(), not by the generic loop.
  timeout: new Set(["-k", "-s", "--kill-after", "--signal"]),
  exec: new Set(["-a"]),
};

export const SHELL_BINARIES = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "ash",
  "mksh",
  "fish",
]);
export const SU_BINARIES = new Set(["su", "runuser", "super"]);

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
export const SHELL_KEYWORDS = new Set([
  "{",
  "}",
  "(",
  ")",
  "then",
  "else",
  "do",
  "elif",
  "!",
]);
