/*
 * Effective-command walk over the segments shell-lexer.ts produces: peels
 * wrappers and destructures command-string forms (`sh -c`, `su -c`,
 * `env -S`, `ssh host cmd`, `busybox applet`, `chroot root cmd`,
 * `timeout duration cmd`). The emergency brake, the capability parser and the
 * script evidence enrichers all consume it.
 *
 * Command-string recursion depth and the total number of resolved effective
 * commands are hard-capped, so adversarial nesting can neither exhaust the
 * stack nor expand the result without bound.
 */

import { invariant } from "./invariant.ts";
import {
  type AnalysisBudget,
  shellBasename as basename,
  lexSegments,
  MAX_EFFECTIVE_COMMANDS,
  newAnalysisBudget,
  normalizeShellRedirections,
  type ShellRedirection,
  type ShellSegment,
  type ShellToken,
} from "./shell-lexer.ts";
import {
  ENV_VALUE_OPTIONS,
  SHELL_BINARIES,
  SHELL_KEYWORDS,
  SU_BINARIES,
  sshValueOption,
  TRANSPARENT_WRAPPERS,
  VALUE_OPTIONS,
} from "./shell-lexer-tables.ts";

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
  const out: ShellToken[][] = [];
  const redirections: ShellRedirection[][] = [];
  const state = { truncated: false };
  const b = budget ?? newAnalysisBudget();
  walk(segment.tokens, out, redirections, [], 0, state, b);
  return { commands: out, redirections, truncated: state.truncated };
}

function walk(
  tokens: ShellToken[],
  out: ShellToken[][],
  redirectionOut: ShellRedirection[][],
  inheritedRedirections: ShellRedirection[],
  depth: number,
  state: { truncated: boolean },
  budget: AnalysisBudget,
): void {
  // Depth and expansion budget: recursion here is driven by the (untrusted)
  // command text, so both bounds are hard stops, not tuning knobs. Hitting
  // either one marks the analysis truncated so downstream gates know the
  // collected commands do not cover the whole command.
  if (
    depth > MAX_WALK_DEPTH ||
    out.length >= MAX_EFFECTIVE_COMMANDS ||
    budget.remainingCommands <= 0
  ) {
    state.truncated = true;
    return;
  }
  const normalized = normalizeShellRedirections(tokens);
  tokens = normalized.tokens;
  const commandRedirections = [
    ...inheritedRedirections,
    ...normalized.redirections,
  ];
  let i = 0;
  while (i < tokens.length && SHELL_KEYWORDS.has(tokens[i]?.value ?? ""))
    i += 1;

  // Consume leading VAR=value assignments (env-style, only at the head).
  while (
    i < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]?.value ?? "")
  )
    i += 1;

  while (i < tokens.length) {
    const tok = tokens[i];
    invariant(tok, "tokens[i] is in bounds");
    if (tok.value === "--") {
      break;
    }
    const base = basename(tok.value);
    if (base === "env") {
      // `env -S 'command string'` (or unquoted: `env -S cmd args…`) carries a
      // parsed command line, and any operands after the string are appended to
      // it. The option may be clustered (`env -iS 'rm -rf /'`), where getopt
      // takes the string from the rest of the cluster or, when S ends the
      // cluster, from the next token. Recurse into the concatenation so
      // `env -S rm -rf /` and `env -iS rm -rf /` are both caught.
      const s = findEnvSCommand(tokens, i + 1);
      if (s !== null && s.script.length > 0) {
        const tail = tokens
          .slice(s.tailIndex)
          .map((t) => t.value)
          .join(" ");
        const reanalyzed = tail ? `${s.script} ${tail}` : s.script;
        budget.remainingReanalysisChars -= reanalyzed.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(reanalyzed))
          walk(
            sub.tokens,
            out,
            redirectionOut,
            commandRedirections,
            depth + 1,
            state,
            budget,
          );
        return;
      }
    }
    if (base === "timeout") {
      // timeout [OPTION]... DURATION COMMAND [ARG]...: unlike the generic
      // wrappers, a mandatory non-option DURATION operand sits between the
      // options and the command, so skip options, then exactly one duration
      // token, then recurse into the real command tail. With no command left
      // (plain `timeout 5` just errors) there is nothing to peel to.
      const valueOpts = VALUE_OPTIONS.timeout ?? new Set<string>();
      let j = i + 1;
      while (j < tokens.length) {
        const token = tokens[j];
        invariant(token, "tokens[j] is in bounds");
        const opt = token.value;
        if (opt === "--") {
          j += 1;
          break;
        }
        if (opt.startsWith("-") && opt.length > 1) {
          j = skipWrapperOption(opt, j, valueOpts);
          continue;
        }
        break;
      }
      if (j < tokens.length) j += 1;
      if (j < tokens.length)
        walk(
          tokens.slice(j),
          out,
          redirectionOut,
          commandRedirections,
          depth + 1,
          state,
          budget,
        );
      return;
    }
    if (TRANSPARENT_WRAPPERS.has(base)) {
      const valueOpts = VALUE_OPTIONS[base] ?? new Set<string>();
      i += 1;
      while (i < tokens.length) {
        const token = tokens[i];
        invariant(token, "tokens[i] is in bounds");
        const opt = token.value;
        if (opt === "--") {
          i += 1;
          break;
        }
        // Env-style VAR=value arguments that follow a wrapper (e.g. `env FOO=bar …`).
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(opt)) {
          i += 1;
          continue;
        }
        if (opt.startsWith("-") && opt.length > 1) {
          i = skipWrapperOption(opt, i, valueOpts);
          continue;
        }
        break;
      }
      continue;
    }
    if (base === "script") {
      // `script -c/--command '…'` runs a command string through a shell;
      // without it, script just starts an interactive session and there is
      // nothing to peel.
      const command = findCommandString(tokens, i + 1);
      if (command !== null) {
        budget.remainingReanalysisChars -= command.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(command))
          walk(
            sub.tokens,
            out,
            redirectionOut,
            commandRedirections,
            depth + 1,
            state,
            budget,
          );
        return;
      }
    }
    if (SHELL_BINARIES.has(base) || SU_BINARIES.has(base)) {
      const script = findCommandString(
        tokens,
        i + 1,
        SHELL_BINARIES.has(base) && base !== "fish",
      );
      if (script !== null) {
        budget.remainingReanalysisChars -= script.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(script))
          walk(
            sub.tokens,
            out,
            redirectionOut,
            commandRedirections,
            depth + 1,
            state,
            budget,
          );
        return;
      }
    }
    if (base === "ssh") {
      const rest = consumeSshRemote(tokens, i + 1);
      if (rest.length > 0) {
        const remote = rest.map((t) => t.value).join(" ");
        budget.remainingReanalysisChars -= remote.length;
        if (budget.remainingReanalysisChars < 0) {
          state.truncated = true;
          return;
        }
        for (const sub of lexSegments(remote))
          walk(
            sub.tokens,
            out,
            redirectionOut,
            commandRedirections,
            depth + 1,
            state,
            budget,
          );
      }
      return;
    }
    if (base === "busybox") {
      if (i + 1 < tokens.length)
        walk(
          tokens.slice(i + 1),
          out,
          redirectionOut,
          commandRedirections,
          depth + 1,
          state,
          budget,
        );
      return;
    }
    if (base === "chroot") {
      // chroot [OPTION]... NEWROOT [COMMAND [ARG]...]: skip options, then the
      // NEWROOT token, then recurse into the real command tail.
      let j = i + 1;
      while (j < tokens.length) {
        const token = tokens[j];
        invariant(token, "tokens[j] is in bounds");
        const opt = token.value;
        if (opt === "--") {
          j += 1;
          break;
        }
        if (opt.startsWith("-") && opt.length > 1) {
          j += 1;
          continue;
        }
        break;
      }
      if (j + 1 < tokens.length)
        walk(
          tokens.slice(j + 1),
          out,
          redirectionOut,
          commandRedirections,
          depth + 1,
          state,
          budget,
        );
      return;
    }
    out.push(tokens.slice(i));
    redirectionOut.push(commandRedirections);
    budget.remainingCommands -= 1;
    return;
  }
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
  valueOpts: Set<string>,
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
  let i = start;
  let endOfFlags = false;
  let shellCommandPending = false;
  while (i < tokens.length) {
    const token = tokens[i];
    invariant(token, "tokens[i] is in bounds");
    const t = token.value;
    if (!endOfFlags && t === "--") {
      if (shellFlags && shellCommandPending) {
        return tokens[i + 1]?.value ?? null;
      }
      endOfFlags = true;
      i += 1;
      continue;
    }
    if (!endOfFlags && t === "-c") {
      if (shellFlags) {
        shellCommandPending = true;
        i += 1;
        continue;
      }
      return tokens[i + 1]?.value ?? null;
    }
    // Long form: `--command` (next token) or `--command=VALUE`.
    if (!endOfFlags && t === "--command") {
      return tokens[i + 1]?.value ?? null;
    }
    if (!endOfFlags && t.startsWith("--command=")) {
      return t.slice("--command=".length);
    }
    if (shellFlags && shellCommandPending) {
      if (!endOfFlags && (t === "-o" || t === "-O")) {
        i += 2;
        continue;
      }
      if (
        !endOfFlags &&
        (t.startsWith("-") || t.startsWith("+")) &&
        t.length > 1
      ) {
        i += 1;
        continue;
      }
      return t;
    }
    // Short-flag cluster containing `c` (e.g. `bash -ic '...'`). getopt
    // semantics: when `c` ends the cluster its value is the next token;
    // when other letters follow (`script -c"rm -rf /"`, `-Sval`), the rest
    // of the cluster IS the value.
    if (
      !endOfFlags &&
      t.startsWith("-") &&
      !t.startsWith("--") &&
      t.length > 1
    ) {
      const cPosition = t.indexOf("c");
      if (cPosition === -1) {
        i += 1;
        continue;
      }
      // Shells treat every letter in -ce/-xec as a flag: the script is
      // the first non-option that follows. More shell options may still sit
      // between that cluster and the script (`sh -c -x -- '...'`). su and
      // script use getopt value semantics instead.
      if (shellFlags) {
        shellCommandPending = true;
        i += 1;
        continue;
      }
      if (cPosition === t.length - 1) {
        return tokens[i + 1]?.value ?? null;
      }
      return t.slice(cPosition + 1);
    }
    i += 1;
  }
  return null;
}

/** Locate the command string carried by a (possibly clustered) `env -S`
 *  option, honoring the other value-taking env options on the way (`-u
 *  NAME`, `-C DIR`, long forms). The string is the next token when S ends
 *  the option token, or the rest of the token when another letter follows
 *  S. Scanning stops at the first operand: after it, the command has begun
 *  and there is no -S. */
function findEnvSCommand(
  tokens: ShellToken[],
  start: number,
): { script: string; tailIndex: number } | null {
  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i];
    invariant(token, "tokens[i] is in bounds");
    const value = token.value;
    if (value === "--") return null;
    if (value.startsWith("--")) {
      if (value === "--split-string") {
        const script = tokens[i + 1];
        if (script === undefined) return null;
        return { script: script.value, tailIndex: i + 2 };
      }
      if (value.startsWith("--split-string=")) {
        return {
          script: value.slice("--split-string=".length),
          tailIndex: i + 1,
        };
      }
      if (ENV_VALUE_OPTIONS.has(value)) i += 1;
      continue;
    }
    if (!value.startsWith("-") || value.length <= 1) return null;
    const letters = value.slice(1);
    for (let position = 0; position < letters.length; position += 1) {
      const letter = letters.charAt(position);
      if (letter === "S") {
        if (position === letters.length - 1) {
          const script = tokens[i + 1];
          if (script === undefined) return null;
          return { script: script.value, tailIndex: i + 2 };
        }
        return { script: letters.slice(position + 1), tailIndex: i + 1 };
      }
      // -u/-C/-P consume a value: the rest of the cluster, or the next
      // token when the letter ends the cluster.
      if (letter === "u" || letter === "C" || letter === "P") {
        if (position === letters.length - 1) i += 1;
        break;
      }
    }
  }
  return null;
}

/** Consume ssh options + host and return the remaining remote-command tokens. */
function consumeSshRemote(tokens: ShellToken[], start: number): ShellToken[] {
  let i = start;
  let hostSeen = false;
  while (i < tokens.length) {
    const token = tokens[i];
    invariant(token, "tokens[i] is in bounds");
    const t = token.value;
    if (t === "--") {
      i += 1;
      break;
    }
    if (t.startsWith("-") && t.length > 1) {
      const valued = sshValueOption(t);
      i += valued !== undefined && valued.attached === undefined ? 2 : 1;
      continue;
    }
    if (!hostSeen) {
      hostSeen = true;
      i += 1;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}
