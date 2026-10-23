// Git network options: the options of each network subcommand that consume a separate value token.

/** Options of the network subcommands that consume a separate value token.
 *  Without skipping the value, `git fetch --depth 1 origin` would report "1"
 *  as the remote operand and hide the real destination. Options with an
 *  OPTIONAL value (`--force-with-lease`, `--rebase`, `--signed`, …) are
 *  deliberately absent: git requires `=` for those, and skipping the next
 *  token would swallow the remote instead. */
export const NETWORK_VALUE_OPTIONS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  push: new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]),
  fetch: new Set([
    "--depth",
    "--deepen",
    "--shallow-since",
    "--shallow-exclude",
    "-j",
    "--jobs",
    "--refmap",
    "--upload-pack",
    "-o",
    "--server-option",
    "--negotiation-tip",
    "--filter",
  ]),
  pull: new Set([
    "--depth",
    "--deepen",
    "--shallow-since",
    "--shallow-exclude",
    "-j",
    "--jobs",
    "--refmap",
    "--upload-pack",
    "-o",
    "--server-option",
    "--negotiation-tip",
    "--filter",
    "-s",
    "--strategy",
    "-X",
    "--strategy-option",
  ]),
  "ls-remote": new Set(["--sort", "--upload-pack", "-o", "--server-option"]),
  remote: new Set(),
};
