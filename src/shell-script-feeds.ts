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

/** A command that reads stdin but is not an effective command of its own: an
 *  ssh with no remote command, or a shell run with `-c` and `-s`. */
export interface StdinReader {
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
  /** The ssh commands with no remote command. */
  remote?: readonly StdinReader[];
  /** The shells run with `-c` and `-s`. */
  shells?: readonly StdinReader[];
  /** A word of the command holds a placeholder together with other text, so
   *  the command was not read the way it was written. */
  glued?: boolean;
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
  /** The stdin is a heredoc or here-string, whatever its text. */
  fed: boolean;
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
  for (const reader of input.shells ?? [])
    take(scriptsOf(input, reader.redirections, reader.pipedFrom), false);
  for (const reader of input.remote ?? [])
    take(scriptsOf(input, reader.redirections, reader.pipedFrom), true);
  return { feeds, unresolved: unresolved || input.glued === true };
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
    return { scripts: [source.text], unresolved: false, fed: true };
  if (source.kind === "unrecorded")
    return { scripts: [], unresolved: false, fed: true };
  if (source.kind !== "script")
    return { scripts: [], unresolved: false, fed: false };
  const held = scripts.get(source.placeholder);
  if (held === undefined) return { scripts: [], unresolved: true, fed: true };
  return { scripts: [...held], unresolved: false, fed: true };
}
