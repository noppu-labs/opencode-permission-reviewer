// The scripts each effective command runs, from the heredoc or here-string its stdin reads: the shells, and an ssh that has no remote command.

import { catPassesStdin, shellReadsStdin } from "./shell-script-readers.ts";
import {
  type ScriptRedirection,
  type StdinSource,
  stdinSource,
} from "./shell-stdin-source.ts";
import type { ShellToken } from "./shell-token.ts";

/** One script a command runs. `remote` marks the login shell on the far side
 *  of an ssh that has no remote command. */
export interface ScriptFeed {
  script: string;
  remote: boolean;
}

/** An ssh with no remote command, which yields no effective command. */
export interface RemoteReader {
  redirections: readonly ScriptRedirection[];
  pipedFrom: number | undefined;
}

export interface ScriptFeedInput {
  effective: readonly (readonly ShellToken[])[];
  /** Per effective command, inherited ones first. */
  redirections: readonly (readonly ScriptRedirection[])[];
  /** Per effective command, the index of the one whose stdout feeds it. */
  pipedFrom: readonly (number | undefined)[];
  /** The readings of each heredoc body, by placeholder. */
  scripts: ReadonlyMap<string, readonly string[]>;
  remote?: readonly RemoteReader[];
}

export interface ScriptFeedResult {
  feeds: ScriptFeed[];
  /** A heredoc that feeds a command has no recorded body. */
  unresolved: boolean;
}

/** The script readings a command's stdin carries. */
export interface StdinScripts {
  scripts: string[];
  unresolved: boolean;
}

/** The scripts that run, one feed per distinct reading. */
export function scriptFeeds(input: ScriptFeedInput): ScriptFeedResult {
  const feeds: ScriptFeed[] = [];
  const seen = { local: new Set<string>(), remote: new Set<string>() };
  let unresolved = false;
  const take = (found: StdinScripts, remote: boolean): void => {
    unresolved = unresolved || found.unresolved;
    const known = remote ? seen.remote : seen.local;
    for (const script of found.scripts) {
      if (known.has(script)) continue;
      known.add(script);
      feeds.push({ script, remote });
    }
  };
  input.effective.forEach((words, index) => {
    if (shellReadsStdin(words)) take(stdinScripts(input, index), false);
  });
  for (const reader of input.remote ?? [])
    take(scriptsOf(input, reader.redirections, reader.pipedFrom), true);
  return { feeds, unresolved };
}

/** The script readings the stdin of effective command `index` carries, the
 *  head not considered: its last stdin redirection decides, and with none, a
 *  plain `cat` before it in the pipeline that has a heredoc or here-string
 *  for its own. */
export function stdinScripts(
  input: ScriptFeedInput,
  index: number,
): StdinScripts {
  return scriptsOf(
    input,
    input.redirections[index] ?? [],
    input.pipedFrom[index],
  );
}

function scriptsOf(
  input: ScriptFeedInput,
  redirections: readonly ScriptRedirection[],
  producer: number | undefined,
): StdinScripts {
  const source = stdinSource(redirections);
  if (source.kind !== "pipe") return readings(source, input.scripts);
  return fromProducer(input, producer);
}

function fromProducer(
  input: ScriptFeedInput,
  producer: number | undefined,
): StdinScripts {
  const words = producer === undefined ? undefined : input.effective[producer];
  if (producer === undefined || words === undefined || !catPassesStdin(words))
    return readings({ kind: "other" }, input.scripts);
  return readings(
    stdinSource(input.redirections[producer] ?? []),
    input.scripts,
  );
}

function readings(
  source: StdinSource,
  scripts: ReadonlyMap<string, readonly string[]>,
): StdinScripts {
  if (source.kind === "text")
    return { scripts: [source.text], unresolved: false };
  if (source.kind !== "script") return { scripts: [], unresolved: false };
  const held = scripts.get(source.placeholder);
  if (held === undefined) return { scripts: [], unresolved: true };
  return { scripts: [...held], unresolved: false };
}
