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
  /** The placeholder of each of its first redirections that is a heredoc. */
  placeholders?: readonly (string | undefined)[];
}

export interface ScriptFeedInput {
  effective: readonly (readonly ShellToken[])[];
  /** Per effective command, inherited ones first. */
  redirections: readonly (readonly ScriptRedirection[])[];
  /** Per effective command, the index of the one whose stdout feeds it. */
  pipedFrom: readonly (number | undefined)[];
  /** Per effective command, the placeholder of each of its first
   *  redirections that is a heredoc and carries none of its own. */
  placeholders?: readonly (readonly (string | undefined)[])[];
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
const OTHER: StdinSource = { kind: "other" };

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
    take(scriptsOf(input, reader), false);
  for (const reader of input.remote ?? []) take(scriptsOf(input, reader), true);
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
  return scriptsFrom(input, sourceAt(input, index), input.pipedFrom[index]);
}

function scriptsOf(input: ScriptFeedInput, reader: StdinReader): StdinScripts {
  const source = stdinSource(reader.redirections, reader.placeholders);
  return scriptsFrom(input, source, reader.pipedFrom);
}

function scriptsFrom(
  input: ScriptFeedInput,
  source: StdinSource,
  producer: number | undefined,
): StdinScripts {
  const read = source.kind === "pipe" ? pipedSource(input, producer) : source;
  return readings(read, input.scripts);
}

/** What each input's commands read, by index, found once: the commands of a
 *  command string share the redirections of the text around it, and a pipe's
 *  producer feeds each of them. */
interface KnownSources {
  own: StdinSource[];
  piped: StdinSource[];
}

const SOURCES = new WeakMap<ScriptFeedInput, KnownSources>();

function knownSources(input: ScriptFeedInput): KnownSources {
  const held = SOURCES.get(input);
  if (held !== undefined) return held;
  const known: KnownSources = { own: [], piped: [] };
  SOURCES.set(input, known);
  return known;
}

function sourceAt(input: ScriptFeedInput, index: number): StdinSource {
  const { own } = knownSources(input);
  own[index] ??= stdinSource(
    input.redirections[index] ?? [],
    input.placeholders?.[index],
  );
  return own[index];
}

/** What a pipe from effective command `producer` carries, when that is a
 *  plain `cat`: what its own stdin reads. */
function pipedSource(
  input: ScriptFeedInput,
  producer: number | undefined,
): StdinSource {
  const words = producer === undefined ? undefined : input.effective[producer];
  if (producer === undefined || words === undefined) return OTHER;
  const { piped } = knownSources(input);
  piped[producer] ??= catPassesStdin(words) ? sourceAt(input, producer) : OTHER;
  return piped[producer];
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
