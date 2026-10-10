// `env -S` / `--split-string` command-string search, getopt clusters included.

import { elementAt } from "./element-at.ts";
import { ENV_VALUE_OPTIONS } from "./shell-lexer-tables.ts";
import type { ShellToken } from "./shell-token.ts";

/** `env -S 'command string'` (or unquoted: `env -S cmd args…`) carries a
 *  parsed command line, and any operands after the string are appended to
 *  it. The concatenation is what gets re-analyzed, so `env -S rm -rf /` and
 *  `env -iS rm -rf /` are both caught. `null` when there is no non-empty
 *  split string. */
export function envSplitString(words: ShellToken[], i: number): string | null {
  const s = findEnvSCommand(words, i + 1);
  if (s === null || s.script.length === 0) return null;
  const tail = words
    .slice(s.tailIndex)
    .map((t) => t.value)
    .join(" ");
  return tail ? `${s.script} ${tail}` : s.script;
}

/** The command string an `env -S` option carries, and the index of the first
 *  operand after it. */
interface EnvSplitString {
  script: string;
  tailIndex: number;
}

/** What one token means for the -S search: the split string it carries,
 *  `null` when the search ends without one, or the index of the next token to
 *  examine. */
type EnvOptionStep = EnvSplitString | null | number;

/** Locate the command string carried by a (possibly clustered) `env -S`
 *  option, honoring the other value-taking env options on the way (`-u
 *  NAME`, `-C DIR`, long forms). The string is the next token when S ends
 *  the option token, or the rest of the token when another letter follows
 *  S. Scanning stops at the first operand: after it, the command has begun
 *  and there is no -S. */
function findEnvSCommand(
  tokens: ShellToken[],
  start: number,
): EnvSplitString | null {
  let i = start;
  while (i < tokens.length) {
    const step = envOptionStep(tokens, i);
    if (typeof step !== "number") return step;
    i = step;
  }
  return null;
}

function envOptionStep(tokens: ShellToken[], i: number): EnvOptionStep {
  const value = elementAt(tokens, i, "tokens").value;
  if (value === "--") return null;
  if (value.startsWith("--")) return longEnvOptionStep(tokens, i, value);
  if (!value.startsWith("-") || value.length <= 1) return null;
  return envClusterStep(tokens, i, value.slice(1));
}

function longEnvOptionStep(
  tokens: ShellToken[],
  i: number,
  value: string,
): EnvOptionStep {
  if (value === "--split-string") return splitStringOperand(tokens, i + 1);
  if (value.startsWith("--split-string="))
    return { script: value.slice("--split-string=".length), tailIndex: i + 1 };
  return ENV_VALUE_OPTIONS.has(value) ? i + 2 : i + 1;
}

/** The first S, u, C or P letter decides the cluster; other letters are
 *  flags. */
function envClusterStep(
  tokens: ShellToken[],
  i: number,
  letters: string,
): EnvOptionStep {
  const position = letters.search(/[SuCP]/);
  if (position === -1) return i + 1;
  const last = position === letters.length - 1;
  if (letters.charAt(position) === "S")
    return last
      ? splitStringOperand(tokens, i + 1)
      : { script: letters.slice(position + 1), tailIndex: i + 1 };
  // -u/-C/-P consume a value: the rest of the cluster, or the next
  // token when the letter ends the cluster.
  return last ? i + 2 : i + 1;
}

/** The split string held by the separate token at `index`; its tail starts
 *  after that token. */
function splitStringOperand(
  tokens: ShellToken[],
  index: number,
): EnvSplitString | null {
  const script = tokens[index];
  if (script === undefined) return null;
  return { script: script.value, tailIndex: index + 1 };
}
