// What the effective-command walk does with an `env`: re-read its -S string, or resume at the command after its options.

import { elementAt } from "./element-at.ts";
import { envLongOptionSpellings } from "./env-long-options.ts";
import { envSplitTexts } from "./env-split-string.ts";
import {
  ENV_VALUE_OPTIONS,
  PREVIOUS_ENV_VALUE_OPTIONS,
} from "./shell-lexer-tables.ts";
import type { ShellToken } from "./shell-token.ts";
import { skipWrapperArguments } from "./shell-wrapper-options.ts";
import type { EnvOptionsTable, WalkLevel } from "./walk-sink.ts";

/** One reading of an `env`: the command strings its -S option carries, or
 *  the index of the command after its options. */
type EnvReading = { texts: string[] } | { resume: number };

/** The walk's own steps: re-lex a command string, or walk the words from
 *  `start`, one level deeper. */
export interface EnvWalk {
  reanalyze(text: string, level: WalkLevel): void;
  walkTail(words: ShellToken[], start: number, level: WalkLevel): void;
}

const TABLES: readonly EnvOptionsTable[] = ["previous", "exact", "spelled"];

function readEnv(
  words: ShellToken[],
  i: number,
  table: EnvOptionsTable,
): EnvReading {
  if (table === "previous")
    return readOptions(words, i, PREVIOUS_ENV_VALUE_OPTIONS);
  if (table === "exact") return readOptions(words, i, ENV_VALUE_OPTIONS);
  // The full spellings stand in for the abbreviations while env is read.
  const spellings = envLongOptionSpellings(words, i, ENV_VALUE_OPTIONS);
  if (spellings.length === 0) return readOptions(words, i, ENV_VALUE_OPTIONS);
  return readOptions(spelledView(words, spellings), i, ENV_VALUE_OPTIONS);
}

/** `words` with the tokens of `spellings` at their indices, as a view that
 *  leaves `words` unchanged and copies none of it. */
function spelledView(
  words: ShellToken[],
  spellings: [number, ShellToken][],
): ShellToken[] {
  const spelled = new Map(spellings.map(([j, token]) => [String(j), token]));
  return new Proxy(words, {
    get: (
      target: ShellToken[],
      key: string | symbol,
      receiver: unknown,
    ): unknown =>
      typeof key === "string" && spelled.has(key)
        ? spelled.get(key)
        : Reflect.get(target, key, receiver),
  });
}

function readOptions(
  words: ShellToken[],
  i: number,
  options: ReadonlySet<string>,
): EnvReading {
  const texts = envSplitTexts(words, i, options);
  if (texts !== null) return { texts };
  return { resume: skipWrapperArguments(words, i, "env", options) };
}

/** Peel the `env` at `i` and return where `level` goes on, `undefined`
 *  once it is done. The tables a level reads env's options with stay
 *  together while they find the same command. At an `env` where they
 *  differ, each group of tables that agree walks its command one level
 *  deeper under those tables alone, and the level goes on under the last
 *  group found, so each table is followed once. */
export function peelEnv(
  words: ShellToken[],
  i: number,
  level: WalkLevel,
  walk: EnvWalk,
): number | undefined {
  const tables = level.reading === "both" ? TABLES : level.reading;
  const groups = new Map<
    string,
    { env: EnvReading; tables: EnvOptionsTable[] }
  >();
  for (const table of tables) {
    const env = readEnv(words, i, table);
    const key = JSON.stringify(env);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { env, tables: [table] });
    else group.tables.push(table);
  }
  const all = [...groups.values()];
  const main = elementAt(all, all.length - 1, "groups");
  for (const side of all.slice(0, -1))
    follow(side.env, words, { ...level, reading: side.tables }, walk, true);
  if (all.length > 1) level.reading = main.tables;
  return follow(main.env, words, level, walk);
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
