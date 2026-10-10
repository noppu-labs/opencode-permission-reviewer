// `-c`/`--command` command-string search: shells take the script after the option cluster, su and script take a getopt value.

import { elementAt } from "./element-at.ts";
import { SHELL_BINARIES, SU_BINARIES } from "./shell-lexer-tables.ts";
import type { ShellToken } from "./shell-token.ts";

/** The command string that `script`, a shell or su at `i` runs, or `null`
 *  when `base` is none of them or carries none. `script -c/--command '…'`
 *  runs a command string through a shell; without it, script just starts an
 *  interactive session and there is nothing to peel. */
export function wrapperCommandString(
  words: ShellToken[],
  i: number,
  base: string,
): string | null {
  if (base === "script") return findCommandString(words, i + 1);
  if (!SHELL_BINARIES.has(base) && !SU_BINARIES.has(base)) return null;
  return findCommandString(
    words,
    i + 1,
    SHELL_BINARIES.has(base) && base !== "fish",
  );
}

/** Find a `-c`/`--command` command-string argument and return its (unquoted) value. */
function findCommandString(
  tokens: ShellToken[],
  start: number,
  shellFlags = false,
): string | null {
  return shellFlags
    ? shellCommandString(tokens, start)
    : getoptCommandString(tokens, start);
}

/** su and script use getopt value semantics. A `--` before any `-c` ends the
 *  options, so nothing after it is a command string. */
function getoptCommandString(
  tokens: ShellToken[],
  start: number,
): string | null {
  for (let i = start; i < tokens.length; i += 1) {
    const t = elementAt(tokens, i, "tokens").value;
    if (t === "--") return null;
    const value = getoptCommandValue(t, tokens[i + 1]?.value ?? null);
    if (value !== undefined) return value;
  }
  return null;
}

/** The command string `t` carries, `next` when its value is the following
 *  token, or `undefined` when `t` is not a command option. In a short-flag
 *  cluster containing `c` (e.g. `su -lc '...'`), getopt semantics apply: when
 *  `c` ends the cluster its value is the next token; when other letters
 *  follow (`script -c"rm -rf /"`), the rest of the cluster IS the value. */
function getoptCommandValue(
  t: string,
  next: string | null,
): string | null | undefined {
  const long = longCommandValue(t, next);
  if (long !== undefined) return long;
  if (!isShortCluster(t)) return undefined;
  const cPosition = t.indexOf("c");
  if (cPosition === -1) return undefined;
  return cPosition === t.length - 1 ? next : t.slice(cPosition + 1);
}

/** Long form: `--command` (next token) or `--command=VALUE`; `undefined` for
 *  any other token. */
function longCommandValue(
  t: string,
  next: string | null,
): string | null | undefined {
  if (t === "--command") return next;
  if (t.startsWith("--command=")) return t.slice("--command=".length);
  return undefined;
}

function isShortCluster(t: string): boolean {
  return t.startsWith("-") && !t.startsWith("--") && t.length > 1;
}

/** Shells treat every letter in -ce/-xec as a flag: the script is the first
 *  non-option after the cluster holding `c`. A `--` before that cluster ends
 *  the options, so nothing after it is a command string. */
function shellCommandString(
  tokens: ShellToken[],
  start: number,
): string | null {
  for (let i = start; i < tokens.length; i += 1) {
    const t = elementAt(tokens, i, "tokens").value;
    if (t === "--") return null;
    const long = longCommandValue(t, tokens[i + 1]?.value ?? null);
    if (long !== undefined) return long;
    if (isShortCluster(t) && t.includes("c"))
      return shellScriptOperand(tokens, i + 1);
  }
  return null;
}

/** The script once the `-c` cluster is seen. More shell options may still sit
 *  between that cluster and the script (`sh -c -x -- '...'`). */
function shellScriptOperand(
  tokens: ShellToken[],
  start: number,
): string | null {
  let i = start;
  while (i < tokens.length) {
    const t = elementAt(tokens, i, "tokens").value;
    if (t === "--") return tokens[i + 1]?.value ?? null;
    const long = longCommandValue(t, tokens[i + 1]?.value ?? null);
    if (long !== undefined) return long;
    const width = shellOptionWidth(t);
    if (width === 0) return t;
    i += width;
  }
  return null;
}

/** Tokens a shell option spans (`-o NAME` and `-O NAME` take a value), or 0
 *  for an operand. */
function shellOptionWidth(t: string): number {
  if (t === "-o" || t === "-O") return 2;
  return (t.startsWith("-") || t.startsWith("+")) && t.length > 1 ? 1 : 0;
}
