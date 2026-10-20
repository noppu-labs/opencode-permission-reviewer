// What the effective-command walk does with an `env`: re-read its -S string, or resume at the command after its options.

import { envSplitTexts } from "./env-split-string.ts";
import {
  ENV_VALUE_OPTIONS,
  PREVIOUS_ENV_VALUE_OPTIONS,
} from "./shell-lexer-tables.ts";
import type { ShellToken } from "./shell-token.ts";
import { skipWrapperArguments } from "./shell-wrapper-options.ts";
import type { WalkLevel } from "./walk-sink.ts";

/** One reading of an `env`: the command strings its -S option carries, or
 *  the index of the command after its options. */
type EnvReading = { texts: string[] } | { resume: number };

/** The walk's own steps: re-lex a command string, or walk the words from
 *  `start`, one level deeper. */
export interface EnvWalk {
  reanalyze(text: string, level: WalkLevel): void;
  walkTail(words: ShellToken[], start: number, level: WalkLevel): void;
}

function readEnv(
  words: ShellToken[],
  i: number,
  reading: Exclude<WalkLevel["reading"], "both">,
): EnvReading {
  const options =
    reading === "current" ? ENV_VALUE_OPTIONS : PREVIOUS_ENV_VALUE_OPTIONS;
  const texts = envSplitTexts(words, i, options);
  if (texts !== null) return { texts };
  return { resume: skipWrapperArguments(words, i, "env", options) };
}

/** Peel the `env` at `i` and return where `level` goes on, `undefined`
 *  once it is done. A level read under `both` readings of env's options
 *  stays so while they agree. At the first `env` where the previous
 *  release's reading finds another command, that command is walked under the
 *  previous reading alone, and the level goes on under the current one, so
 *  each reading is followed once. */
export function peelEnv(
  words: ShellToken[],
  i: number,
  level: WalkLevel,
  walk: EnvWalk,
): number | undefined {
  if (level.reading !== "both")
    return follow(readEnv(words, i, level.reading), words, level, walk);
  const current = readEnv(words, i, "current");
  const previous = readEnv(words, i, "previous");
  if (JSON.stringify(current) !== JSON.stringify(previous)) {
    follow(previous, words, { ...level, reading: "previous" }, walk, true);
    level.reading = "current";
  }
  return follow(current, words, level, walk);
}

/** Go on with one reading in `level`; a `side` reading walks its command
 *  one level deeper instead of resuming at it. */
function follow(
  env: EnvReading,
  words: ShellToken[],
  level: WalkLevel,
  walk: EnvWalk,
  side = false,
): number | undefined {
  if ("texts" in env) {
    for (const text of env.texts) walk.reanalyze(text, level);
    return undefined;
  }
  if (side) walk.walkTail(words, env.resume, level);
  return side ? undefined : env.resume;
}
