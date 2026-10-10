// Path, mutation-operand, redirection and git-subcommand helpers for the bash capability analyzer.

import { homedir } from "node:os";
import { normalize, resolve, sep } from "node:path";
import { elementAt } from "../element-at.ts";
import { invariant } from "../invariant.ts";
import type { ShellToken } from "../shell-token.ts";
import {
  GIT_MUTATION_SUBCOMMANDS,
  MUTATION_VALUE_OPTIONS,
} from "./bash-command-tables.ts";
import type { Redirection } from "./capability-types.ts";

/** A remote operand for rsync-style tools: a URL scheme, or an `host:path`
 *  / `user@host:path` shape whose part before the colon is a bare host (no
 *  slash), which is exactly how rsync decides local-with-colon vs remote. */
export function isRemoteMutationOperand(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) return true;
  const colon = value.indexOf(":");
  return colon > 0 && !value.slice(0, colon).includes("/");
}

/** Split a cp/mv/ln/rsync invocation into read sources and write
 *  destinations. The last positional operand is the destination (cp/mv/rsync
 *  destination, ln link name); `--target-directory`/`-t` names an additional
 *  destination directory everything lands under. Paths after `--` are
 *  operands like any other. */
export function mutationOperands(
  base: string,
  cmd: ReadonlyArray<{ value: string }>,
): { sources: string[]; destinations: string[]; sawOperand: boolean } {
  const valueOpts = MUTATION_VALUE_OPTIONS[base] ?? new Set<string>();
  const { operands, targetDirectory } = scanMutationArguments(cmd, valueOpts);
  if (targetDirectory !== undefined) {
    // `-t DIR` redirects every SOURCE argument into DIR: with it, no operand
    // is itself a destination.
    return {
      sources: operands,
      destinations: [targetDirectory],
      sawOperand: operands.length > 0,
    };
  }
  if (base === "rename") {
    // rename rewrites each named file, rather than copying to the last
    // operand. Keep every operand as a possible mutation across dialects.
    return {
      sources: [],
      destinations: operands,
      sawOperand: operands.length > 0,
    };
  }
  if (base === "ln" && operands.length === 1) {
    return { sources: operands, destinations: ["."], sawOperand: true };
  }
  const destinations: string[] = [];
  const lastOperand = operands.at(-1);
  if (lastOperand !== undefined) destinations.push(lastOperand);
  const sources = operands.length > 1 ? operands.slice(0, -1) : [];
  return { sources, destinations, sawOperand: operands.length > 0 };
}

/** The positional operands of a mutation command and the last
 *  `--target-directory`/`-t` value seen. */
interface MutationArguments {
  operands: string[];
  targetDirectory: string | undefined;
}

function scanMutationArguments(
  cmd: ReadonlyArray<{ value: string }>,
  valueOpts: ReadonlySet<string>,
): MutationArguments {
  const scan: MutationArguments = { operands: [], targetDirectory: undefined };
  for (let i = 1; i < cmd.length; i += 1)
    i = scanArgument(cmd, i, valueOpts, scan);
  return scan;
}

/** Apply the word at `i`; returns the index of the last word it consumed. */
function scanArgument(
  cmd: ReadonlyArray<{ value: string }>,
  i: number,
  valueOpts: ReadonlySet<string>,
  scan: MutationArguments,
): number {
  const v = elementAt(cmd, i, "cmd").value;
  if (v === "--") {
    // Every word after the first `--` is an operand, `--` included.
    for (const token of cmd.slice(i + 1)) scan.operands.push(token.value);
    return cmd.length;
  }
  if (v.startsWith("--")) return scanLongOption(cmd, i, v, valueOpts, scan);
  if (v.startsWith("-") && v.length > 1)
    return scanShortOptions(cmd, i, v, valueOpts, scan);
  scan.operands.push(v);
  return i;
}

function scanLongOption(
  cmd: ReadonlyArray<{ value: string }>,
  i: number,
  v: string,
  valueOpts: ReadonlySet<string>,
  scan: MutationArguments,
): number {
  if (valueOpts.has(v)) {
    if (v === "--target-directory") scan.targetDirectory = cmd[i + 1]?.value;
    return i + 1;
  }
  if (
    valueOpts.has("--target-directory") &&
    v.startsWith("--target-directory=")
  ) {
    scan.targetDirectory = v.slice("--target-directory=".length);
  }
  return i;
}

/** The first value-taking option in a short cluster ends it and takes the
 *  attached rest or, when nothing is attached, the next word. */
function scanShortOptions(
  cmd: ReadonlyArray<{ value: string }>,
  i: number,
  v: string,
  valueOpts: ReadonlySet<string>,
  scan: MutationArguments,
): number {
  for (let position = 1; position < v.length; position += 1) {
    const option = `-${v.charAt(position)}`;
    if (!valueOpts.has(option)) continue;
    const attached = v.slice(position + 1);
    const last = attached ? i : i + 1;
    if (option === "-t") scan.targetDirectory = attached || cmd[last]?.value;
    return last;
  }
  return i;
}

/** Mutating forms of executables that are otherwise treated as read-only.
 *  "This executable usually only reads" must never become "this invocation
 *  only reads": find/sort/yq all have flags that delete, write, or execute. */
interface ReadOnlyToolMutation {
  deletion?: boolean;
  executesCode?: boolean;
  /** Paths written or (for -delete) destroyed, classified like any write. */
  writeTargets: string[];
}

/** Placeholder target when a mutating form names no operand: conservatively
 *  treated as a workspace write (the current directory). */
const directoryFallback = ".";

export function readOnlyToolMutation(
  cmd: ShellToken[],
  base: string,
): ReadOnlyToolMutation | undefined {
  if (base === "find") return findMutation(cmd);
  if (base === "sort") return sortMutation(cmd);
  if (base === "yq") return yqMutation(cmd);
  return undefined;
}

function findMutation(cmd: ShellToken[]): ReadOnlyToolMutation | undefined {
  let index = findRootsStart(cmd);
  const roots: string[] = [];
  let root = cmd[index];
  while (
    root !== undefined &&
    !root.value.startsWith("-") &&
    root.value !== "!" &&
    root.value !== "("
  ) {
    roots.push(root.value);
    index += 1;
    root = cmd[index];
  }
  const result: ReadOnlyToolMutation = { writeTargets: [] };
  for (; index < cmd.length; index += 1)
    applyFindAction(cmd, index, roots, result);
  return result.deletion ||
    result.executesCode ||
    result.writeTargets.length > 0
    ? result
    : undefined;
}

/** GNU find accepts traversal options before its search roots. In
 *  particular, `-D` consumes a separate diagnostics value; treating that
 *  value as the root would hide a later `/ -delete`. Returns the index just
 *  past those options. */
function findRootsStart(cmd: ShellToken[]): number {
  let index = 1;
  while (index < cmd.length) {
    const value = elementAt(cmd, index, "cmd").value;
    if (value === "--") return index + 1;
    const width = findTraversalOptionWidth(value);
    if (width === 0) return index;
    index += width;
  }
  return index;
}

/** Words a leading find traversal option spans, or 0 for any other word. */
function findTraversalOptionWidth(value: string): number {
  if (value === "-D") return 2;
  if (
    value === "-H" ||
    value === "-L" ||
    value === "-P" ||
    /^-O\d+$/.test(value)
  )
    return 1;
  return 0;
}

function applyFindAction(
  cmd: ShellToken[],
  index: number,
  roots: string[],
  result: ReadOnlyToolMutation,
): void {
  const value = elementAt(cmd, index, "cmd").value;
  if (value === "-delete") {
    result.deletion = true;
    result.writeTargets.push(...roots);
  } else if (value.startsWith("-exec") || value.startsWith("-ok")) {
    // -exec / -execdir / -ok / -okdir run an arbitrary command per match.
    result.executesCode = true;
  } else if (value === "-fls" || value.startsWith("-fprint")) {
    pushOptionValue(cmd, index, result.writeTargets);
  }
}

/** Push the word after the option at `index`, unless it is missing or looks
 *  like another option. */
function pushOptionValue(
  cmd: ShellToken[],
  index: number,
  targets: string[],
): void {
  const target = cmd[index + 1]?.value;
  if (target !== undefined && !target.startsWith("-")) targets.push(target);
}

function sortMutation(cmd: ShellToken[]): ReadOnlyToolMutation | undefined {
  const result: ReadOnlyToolMutation = { writeTargets: [] };
  for (let index = 1; index < cmd.length; index += 1) {
    const value = elementAt(cmd, index, "cmd").value;
    if (value === "-o" || value === "--output") {
      pushOptionValue(cmd, index, result.writeTargets);
    } else if (value.startsWith("--output=")) {
      result.writeTargets.push(value.slice("--output=".length));
    } else if (value.startsWith("-o") && value.length > 2) {
      result.writeTargets.push(value.slice(2));
    }
  }
  return result.writeTargets.length > 0 ? result : undefined;
}

/** In-place edit: the file operand(s) after the expression are rewritten. */
function yqMutation(cmd: ShellToken[]): ReadOnlyToolMutation | undefined {
  if (!cmd.some((token) => token.value === "-i" || token.value === "--inplace"))
    return undefined;
  const targets = cmd
    .slice(1)
    .map((token) => token.value)
    .filter((value) => !value.startsWith("-"));
  return targets.length > 0
    ? { writeTargets: targets }
    : { writeTargets: [directoryFallback] };
}

export function hasWriteRedirect(redirections: Redirection[]): boolean {
  return redirections.some(redirectionWritesPath);
}

export function redirectionWritesPath(redirection: Redirection): boolean {
  const operator = redirection.operator.replace(/^\d+/, "");
  if ([">", ">>", ">|", "&>", "&>>", "<>"].includes(operator)) return true;
  // Without an explicit IO number, `>&file` is the historical spelling of
  // redirecting stdout and stderr to a file. `2>&1` only duplicates an FD.
  return (
    operator === ">&" &&
    !/^\d/.test(redirection.operator) &&
    redirection.target !== "-" &&
    !/^\d+$/.test(redirection.target)
  );
}

/** Classify a path target as temporary, workspace, or external. Relative
 *  targets (including `..` segments and `~/` homes) are resolved against the
 *  working directory first, and ABSOLUTE targets are lexically normalized, so
 *  neither `../../outside` nor `/worktree/../etc` can masquerade as a
 *  workspace path through a prefix it only appears to have. Lexical
 *  normalization cannot resolve symlinked directory components — the class
 *  always describes the stated path, not a filesystem-verified destination. */
export function classifyPath(
  target: string,
  directory: string,
  worktree: string,
): { temporary: boolean; workspace: boolean; external: boolean } {
  if (!target || target.startsWith("&"))
    return { temporary: false, workspace: false, external: false };
  let temp = false;
  let external = false;
  let absolute: string;
  if (target === "~" || target.startsWith("~/")) {
    absolute = resolve(homedir(), target.slice(target === "~" ? 1 : 2));
  } else if (!target.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(target)) {
    absolute = resolve(directory, target);
  } else {
    absolute = normalize(target);
  }
  const absolutePath =
    absolute.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absolute);
  const within = (root: string): boolean => {
    const normalizedRoot = normalize(root);
    return (
      absolute === normalizedRoot ||
      absolute.startsWith(`${normalizedRoot}${sep}`)
    );
  };
  if (!absolutePath) {
    // A path that still has no absolute form cannot be classified.
    return { temporary: temp, workspace: false, external };
  }
  const workspace = within(directory) || within(worktree);
  temp =
    absolute === "/tmp" ||
    absolute.startsWith("/tmp/") || // NOSONAR(S5443) classifies the target path of a command as temporary; no file is created or used here
    absolute === "/var/tmp" ||
    absolute.startsWith("/var/tmp/") || // NOSONAR(S5443) classifies the target path of a command as temporary; no file is created or used here
    absolute === "/dev/shm" ||
    absolute.startsWith("/dev/shm/") || // NOSONAR(S5443) classifies the target path of a command as temporary; no file is created or used here
    absolute === "/dev/null";
  external = !workspace && !temp;
  return { temporary: temp, workspace, external };
}

export function destinationFromTokens(tokens: ShellToken[]): string[] {
  const out: string[] = [];
  for (const token of tokens.slice(1)) {
    const v = token.value;
    if (/^[a-z][a-z0-9+.-]*:\/\/[^\s]+/.test(v)) out.push(v);
    else if (/^[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?(\/[^\s]*)?$/i.test(v))
      out.push(v);
  }
  return out;
}

/** Resolve a git subcommand from the token stream, skipping global git flags
 *  (`-C <path>`, `-c <cfg>`, `--git-dir`, …) so `git -C /repo push` still
 *  detects the `push` mutation. Mirrors `gitSubcommand()` in
 *  `src/git-command-plan.ts`. */
export function gitSubcommandOf(cmd: ShellToken[]): {
  sub?: string;
  index?: number;
} {
  let index = 1;
  while (index < cmd.length) {
    const token = cmd[index];
    invariant(token, "cmd[index] is in bounds");
    const value = token.value;
    if (
      value === "-C" ||
      value === "-c" ||
      value === "--git-dir" ||
      value === "--work-tree" ||
      value === "--namespace" ||
      value === "--exec-path" ||
      value === "--super-prefix"
    ) {
      index += 2;
      continue;
    }
    if (value.startsWith("-") && value.length > 1) {
      index += 1;
      continue;
    }
    return { sub: value, index };
  }
  return {};
}

/** Distinguish the common read-only forms of Git subcommands that also have
 * mutation modes. Everything else in the mutation set stays conservative. */
export function gitSubcommandMutates(
  cmd: ShellToken[],
  sub: string,
  index: number,
): boolean {
  if (!GIT_MUTATION_SUBCOMMANDS.has(sub)) return false;
  const args = cmd.slice(index + 1).map((token) => token.value);
  const positional = args.filter(
    (value) => value !== "--" && !value.startsWith("-"),
  );
  const firstPositional = positional[0];
  if (sub === "branch") {
    if (args.length === 0) return false;
    if (
      args.some((value) =>
        [
          "-a",
          "--all",
          "-r",
          "--remotes",
          "-l",
          "--list",
          "-v",
          "-vv",
          "--show-current",
          "--contains",
          "--no-contains",
          "--merged",
          "--no-merged",
          "--points-at",
          "--format",
          "--sort",
          "--column",
        ].includes(value),
      )
    )
      return false;
  }
  if (sub === "tag") {
    if (args.length === 0) return false;
    if (
      args.some((value) =>
        [
          "-l",
          "--list",
          "--contains",
          "--no-contains",
          "--merged",
          "--no-merged",
          "--points-at",
          "--format",
          "--sort",
          "--column",
        ].includes(value),
      )
    )
      return false;
  }
  if (sub === "remote") {
    return (
      firstPositional !== undefined &&
      !["show", "get-url"].includes(firstPositional)
    );
  }
  if (sub === "config") {
    if (
      args.some((value) =>
        [
          "--list",
          "-l",
          "--get",
          "--get-all",
          "--get-regexp",
          "--get-urlmatch",
          "--show-origin",
          "--show-scope",
          "get",
          "get-all",
          "get-regexp",
          "get-urlmatch",
          "list",
        ].includes(value),
      )
    )
      return false;
    return (
      positional.length >= 2 ||
      args.some((value) => /(?:add|set|unset|remove|rename)/.test(value))
    );
  }
  if (
    sub === "worktree" &&
    (positional.length === 0 || positional[0] === "list")
  )
    return false;
  if (
    sub === "notes" &&
    (firstPositional === undefined ||
      ["list", "show"].includes(firstPositional))
  )
    return false;
  if (
    sub === "submodule" &&
    (firstPositional === undefined ||
      ["status", "summary"].includes(firstPositional))
  )
    return false;
  if (sub === "symbolic-ref") {
    return args.includes("--delete") || positional.length >= 2;
  }
  return true;
}

/** Whether a token value is a static literal path candidate. Dynamic values
 *  (variables, command substitution, globs) never count as credential reads:
 *  the analyzer cannot resolve what they point at. */
export function isLiteralPathValue(value: string): boolean {
  if (!value) return false;
  if (/[$`*?[\]{}]/.test(value)) return false;
  return true;
}
