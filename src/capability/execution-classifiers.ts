// Code-execution classifiers for one effective command: interpreters, test runners, runtime test subcommands and package managers.

import type { ShellToken } from "../shell-token.ts";
import {
  INTERPRETERS,
  PACKAGE_MANAGERS,
  PACKAGE_SUBCOMMANDS,
  TEST_RUNNERS,
} from "./bash-command-tables.ts";
import { hasInlineCodeOption } from "./bash-facts.ts";
import type { AnalysisRoots, CapabilityFacts } from "./capability-facts.ts";

/** What the classifiers see besides the command: the roots, and the files
 *  the command's heredocs write. */
export interface CommandContext extends AnalysisRoots {
  heredocOutputs: ReadonlySet<string>;
}

const CHILD_PROCESS_INTERPRETERS = [
  "bun",
  "node",
  "python",
  "python3",
  "deno",
  "tsx",
];

export function classifyInterpreter(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
  context: CommandContext,
): void {
  if (!INTERPRETERS.has(base)) return;
  facts.executesCode = true;
  if (CHILD_PROCESS_INTERPRETERS.includes(base)) facts.childProcesses = true;
  const { inline } = hasInlineCodeOption(cmd);
  if (inline) facts.createsAdHocCode = true;
  // If the interpreter targets a generated/heredoc file, it's ad-hoc code.
  for (const token of cmd.slice(1))
    classifyInterpreterArg(token.value, facts, context);
}

function classifyInterpreterArg(
  arg: string,
  facts: CapabilityFacts,
  context: CommandContext,
): void {
  if (context.heredocOutputs.has(arg)) facts.createsAdHocCode = true;
  if (arg.startsWith(context.directory) || arg.startsWith(context.worktree))
    facts.executesRepositoryCode = true;
}

function markTestRun(facts: CapabilityFacts): void {
  facts.invokesTestRunner = true;
  facts.executesCode = true;
  facts.executesRepositoryCode = true;
  facts.childProcesses = true;
}

export function classifyTestRunner(base: string, facts: CapabilityFacts): void {
  if (TEST_RUNNERS.has(base)) markTestRun(facts);
}

/** `<runtime> test` / `<runtime> t` (bun, npm, pnpm, yarn, deno, …). Test
 *  invocations always execute code: the runner and the suite itself are
 *  executable repository content, so `executesCode` must be true, not
 *  unknown (a `read-only` class for `npm test` understates the effect). */
export function classifyTestSubcommand(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
): void {
  if (!INTERPRETERS.has(base) && !PACKAGE_MANAGERS.has(base)) return;
  const sub = cmd[1]?.value;
  if (sub === "test" || sub === "t" || sub === "check" || sub === "verify")
    markTestRun(facts);
}

export function classifyPackageManager(
  cmd: ShellToken[],
  base: string,
  facts: CapabilityFacts,
): void {
  if (!PACKAGE_MANAGERS.has(base)) return;
  const sub = cmd[1]?.value;
  const subs = PACKAGE_SUBCOMMANDS[base];
  if (subs !== undefined && sub !== undefined && !subs.has(sub)) return;
  facts.invokesPackageLifecycle = true;
  facts.childProcesses = true;
  facts.networkPossible = true;
  if (["run", "exec"].includes(sub ?? "")) {
    // A local manifest script or installed executable can use the network,
    // but its invocation is not evidence of an actual network operation, so
    // `run` and `exec` leave networkObserved unset.
    facts.executesCode = true;
    if (sub === "run") facts.executesRepositoryCode = true;
  } else {
    facts.networkObserved = true;
  }
}
