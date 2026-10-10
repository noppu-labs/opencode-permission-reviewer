/*
 * Effective-command walk over the segments shell-scanner.ts produces: peels
 * wrappers and destructures command-string forms (`sh -c`, `su -c`,
 * `env -S`, `ssh host cmd`, `busybox applet`, `chroot root cmd`,
 * `timeout duration cmd`). The emergency brake, the capability parser and the
 * script evidence enrichers all consume it.
 *
 * Command-string recursion depth and the total number of resolved effective
 * commands are hard-capped, so adversarial nesting can neither exhaust the
 * stack nor expand the result without bound.
 */

import { elementAt } from "./element-at.ts";
import {
  type AnalysisBudget,
  shellBasename as basename,
  MAX_EFFECTIVE_COMMANDS,
  newAnalysisBudget,
} from "./shell-lexer.ts";
import {
  ENV_VALUE_OPTIONS,
  SHELL_BINARIES,
  SHELL_KEYWORDS,
  SU_BINARIES,
  TRANSPARENT_WRAPPERS,
  VALUE_OPTIONS,
} from "./shell-lexer-tables.ts";
import {
  normalizeShellRedirections,
  type ShellRedirection,
} from "./shell-redirections.ts";
import { lexSegments } from "./shell-scanner.ts";
import type { ShellSegment, ShellToken } from "./shell-token.ts";
import { sshValueOption } from "./ssh-value-options.ts";

/** Ceiling on command-string re-entry (`sh -c`, `env -S`, ssh, busybox,
 *  chroot). Deeper nesting than this is not a legitimate review shape; the
 *  walk stops descending and the unanalyzed remainder stays the model
 *  reviewer's job, keeping unbounded input from exhausting the stack. */
const MAX_WALK_DEPTH = 32;

/**
 * Resolve a segment into its "effective commands" — the token lists starting
 * at each real executable, after peeling wrappers and destructuring
 * command-string forms. May yield multiple commands when a shell/su `-c` body
 * itself contains separators.
 */
export function effectiveCommands(segment: ShellSegment): ShellToken[][] {
  return analyzeEffectiveCommands(segment).commands;
}

/** Result of bounded command-string resolution. `truncated` is true when the
 *  depth or expansion budget stopped the descent, meaning `commands` is a
 *  prefix of the real structure: parts of the command were never analyzed. */
export interface EffectiveCommandsAnalysis {
  commands: ShellToken[][];
  /** Redirections removed from each effective command, in matching order. */
  redirections: ShellRedirection[][];
  truncated: boolean;
}

/** Resolve one segment into effective commands. Pass a shared `budget` to
 *  cover a whole request: without it, every segment gets a fresh ceiling and
 *  a wide input never reports truncation. */
export function analyzeEffectiveCommands(
  segment: ShellSegment,
  budget?: AnalysisBudget,
): EffectiveCommandsAnalysis {
  const sink: WalkSink = {
    commands: [],
    redirections: [],
    truncated: false,
    budget: budget ?? newAnalysisBudget(),
  };
  walk(segment.tokens, sink, [], 0);
  return {
    commands: sink.commands,
    redirections: sink.redirections,
    truncated: sink.truncated,
  };
}

/** Where every level of one walk collects its effective commands. */
interface WalkSink {
  commands: ShellToken[][];
  redirections: ShellRedirection[][];
  truncated: boolean;
  budget: AnalysisBudget;
}

/** One level of the walk: the redirections its commands carry, inherited
 *  ones first, and its command-string re-entry depth. */
interface WalkLevel {
  sink: WalkSink;
  redirections: ShellRedirection[];
  depth: number;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NO_VALUE_OPTIONS: ReadonlySet<string> = new Set();

function walk(
  tokens: ShellToken[],
  sink: WalkSink,
  inheritedRedirections: ShellRedirection[],
  depth: number,
): void {
  // Depth and expansion budget: recursion here is driven by the (untrusted)
  // command text, so both bounds are hard stops, not tuning knobs. Hitting
  // either one marks the analysis truncated so downstream gates know the
  // collected commands do not cover the whole command.
  if (
    depth > MAX_WALK_DEPTH ||
    sink.commands.length >= MAX_EFFECTIVE_COMMANDS ||
    sink.budget.remainingCommands <= 0
  ) {
    sink.truncated = true;
    return;
  }
  const normalized = normalizeShellRedirections(tokens);
  const words = normalized.tokens;
  const level: WalkLevel = {
    sink,
    redirections: [...inheritedRedirections, ...normalized.redirections],
    depth,
  };
  let i: number | undefined = commandStart(words);
  while (i !== undefined && i < words.length) i = peel(words, i, level);
}

/** Skip leading keywords, then leading VAR=value assignments (env-style,
 *  only at the head). */
function commandStart(words: ShellToken[]): number {
  let i = 0;
  while (
    i < words.length &&
    SHELL_KEYWORDS.has(elementAt(words, i, "tokens").value)
  )
    i += 1;
  while (
    i < words.length &&
    ASSIGNMENT.test(elementAt(words, i, "tokens").value)
  )
    i += 1;
  return i;
}

/** Resolve the word at `i`. Returns the index to resume at after a
 *  transparent wrapper, or `undefined` once this level is done. */
function peel(
  words: ShellToken[],
  i: number,
  level: WalkLevel,
): number | undefined {
  const word = elementAt(words, i, "tokens").value;
  if (word === "--") return undefined;
  const base = basename(word);
  if (base === "env" && reanalyzeIfPresent(envSplitString(words, i), level))
    return undefined;
  if (base === "timeout") {
    // timeout [OPTION]... DURATION COMMAND [ARG]...: unlike the generic
    // wrappers, a mandatory non-option DURATION operand sits between the
    // options and the command, so skip options, then exactly one duration
    // token, then recurse into the real command tail. With no command left
    // (plain `timeout 5` just errors) there is nothing to peel to.
    const duration = skipOptions(words, i + 1, valueOptionsOf("timeout"));
    walkTail(words, duration + 1, level);
    return undefined;
  }
  if (TRANSPARENT_WRAPPERS.has(base))
    return skipWrapperArguments(words, i + 1, valueOptionsOf(base));
  peelCommand(words, i, base, level);
  return undefined;
}

/** The checks after the transparent wrappers, in order: a command string,
 *  an operand tail, or the effective command itself. */
function peelCommand(
  words: ShellToken[],
  i: number,
  base: string,
  level: WalkLevel,
): void {
  // `script -c/--command '…'` runs a command string through a shell;
  // without it, script just starts an interactive session and there is
  // nothing to peel.
  if (
    base === "script" &&
    reanalyzeIfPresent(findCommandString(words, i + 1), level)
  )
    return;
  if (reanalyzeIfPresent(suOrShellCommandString(words, i, base), level)) return;
  if (base === "ssh") {
    const rest = consumeSshRemote(words, i + 1);
    if (rest.length > 0) reanalyze(rest.map((t) => t.value).join(" "), level);
    return;
  }
  if (base === "busybox") {
    walkTail(words, i + 1, level);
    return;
  }
  if (base === "chroot") {
    // chroot [OPTION]... NEWROOT [COMMAND [ARG]...]: skip options, then the
    // NEWROOT token, then recurse into the real command tail.
    const newRoot = skipOptions(words, i + 1, NO_VALUE_OPTIONS);
    walkTail(words, newRoot + 1, level);
    return;
  }
  const { sink } = level;
  sink.commands.push(words.slice(i));
  sink.redirections.push(level.redirections);
  sink.budget.remainingCommands -= 1;
}

/** `env -S 'command string'` (or unquoted: `env -S cmd args…`) carries a
 *  parsed command line, and any operands after the string are appended to
 *  it. The option may be clustered (`env -iS 'rm -rf /'`), where getopt
 *  takes the string from the rest of the cluster or, when S ends the
 *  cluster, from the next token. The concatenation is what gets re-analyzed,
 *  so `env -S rm -rf /` and `env -iS rm -rf /` are both caught. `null` when
 *  there is no non-empty split string. */
function envSplitString(words: ShellToken[], i: number): string | null {
  const s = findEnvSCommand(words, i + 1);
  if (s === null || s.script.length === 0) return null;
  const tail = words
    .slice(s.tailIndex)
    .map((t) => t.value)
    .join(" ");
  return tail ? `${s.script} ${tail}` : s.script;
}

/** The `-c` script of a shell or su invocation, or `null` when `base` is
 *  neither or carries none. */
function suOrShellCommandString(
  words: ShellToken[],
  i: number,
  base: string,
): string | null {
  if (!SHELL_BINARIES.has(base) && !SU_BINARIES.has(base)) return null;
  return findCommandString(
    words,
    i + 1,
    SHELL_BINARIES.has(base) && base !== "fish",
  );
}

/** Re-analyze `text` when there is one; reports whether it did. */
function reanalyzeIfPresent(text: string | null, level: WalkLevel): boolean {
  if (text === null) return false;
  reanalyze(text, level);
  return true;
}

/** Re-lex a command string and walk each of its segments one level deeper.
 *  Its length is charged to the re-analysis budget first. */
function reanalyze(text: string, level: WalkLevel): void {
  const { sink } = level;
  sink.budget.remainingReanalysisChars -= text.length;
  if (sink.budget.remainingReanalysisChars < 0) {
    sink.truncated = true;
    return;
  }
  for (const sub of lexSegments(text))
    walk(sub.tokens, sink, level.redirections, level.depth + 1);
}

/** Walk the operand tail from `start` one level deeper, if any is left. */
function walkTail(words: ShellToken[], start: number, level: WalkLevel): void {
  if (start < words.length)
    walk(words.slice(start), level.sink, level.redirections, level.depth + 1);
}

function valueOptionsOf(wrapper: string): ReadonlySet<string> {
  return VALUE_OPTIONS[wrapper] ?? NO_VALUE_OPTIONS;
}

/** Skip options up to the first operand, or past a `--`, and return its
 *  index. */
function skipOptions(
  words: ShellToken[],
  start: number,
  valueOpts: ReadonlySet<string>,
): number {
  let j = start;
  while (j < words.length) {
    const opt = elementAt(words, j, "tokens").value;
    if (opt === "--") return j + 1;
    if (!opt.startsWith("-") || opt.length <= 1) return j;
    j = skipWrapperOption(opt, j, valueOpts);
  }
  return j;
}

/** Skip a transparent wrapper's options and the env-style VAR=value
 *  arguments that may follow it (e.g. `env FOO=bar …`), and return the index
 *  of the wrapped command. */
function skipWrapperArguments(
  words: ShellToken[],
  start: number,
  valueOpts: ReadonlySet<string>,
): number {
  let i = start;
  while (i < words.length) {
    const opt = elementAt(words, i, "tokens").value;
    if (opt === "--") return i + 1;
    if (ASSIGNMENT.test(opt)) i += 1;
    else if (opt.startsWith("-") && opt.length > 1)
      i = skipWrapperOption(opt, i, valueOpts);
    else return i;
  }
  return i;
}

/** Short-option clusters follow getopt semantics: a value-taking letter takes
 *  the rest of the cluster as its value (`-uroot`, `-un` where `u` takes `n`)
 *  or, when it is last, the next token (`-nu root`).
 *  Misreading a cluster would swallow the wrapped command or mistake the value
 *  for the executable, so `sudo -nu root rm …` must skip the cluster and
 *  `root` together. */
function skipWrapperOption(
  opt: string,
  index: number,
  valueOpts: ReadonlySet<string>,
): number {
  if (valueOpts.has(opt)) return index + 2;
  if (opt.startsWith("--")) return index + 1;
  const letters = opt.slice(1);
  for (let position = 0; position < letters.length; position += 1) {
    if (valueOpts.has(`-${letters.charAt(position)}`)) {
      return position === letters.length - 1 ? index + 2 : index + 1;
    }
  }
  return index + 1;
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

/** Consume ssh options + host and return the remaining remote-command tokens. */
function consumeSshRemote(tokens: ShellToken[], start: number): ShellToken[] {
  let i = start;
  let hostSeen = false;
  while (i < tokens.length) {
    const t = elementAt(tokens, i, "tokens").value;
    if (t === "--") return tokens.slice(i + 1);
    if (t.startsWith("-") && t.length > 1) i += sshOptionWidth(t);
    else if (hostSeen) break;
    else {
      hostSeen = true;
      i += 1;
    }
  }
  return tokens.slice(i);
}

function sshOptionWidth(t: string): number {
  const valued = sshValueOption(t);
  return valued !== undefined && valued.attached === undefined ? 2 : 1;
}
