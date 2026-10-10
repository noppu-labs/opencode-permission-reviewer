// Shell command segments with the working directory tracked across cd chains and subshell groups,
// shared by the ssh, local-script, package-script and git evidence.

import { basename, isAbsolute, resolve } from "node:path";
import { commandSegments } from "./shell-lexer.ts";

function shellCommandSegments(
  command: string,
): Array<{ tokens: string[]; preceding?: string; endedBy?: string }> {
  return commandSegments(command).map((segment) => ({
    tokens: segment.tokens,
    ...(segment.preceding === undefined
      ? {}
      : { preceding: segment.preceding }),
    ...(segment.endedBy === undefined ? {} : { endedBy: segment.endedBy }),
  }));
}

export interface ShellCommandSegmentWithDirectory {
  tokens: string[];
  preceding?: string;
  directory?: string;
  directoryReason?: string;
}

function cdTarget(
  tokens: string[],
  directory: string | undefined,
): { directory?: string; reason?: string } {
  const [head] = tokens;
  if (tokens.length < 2 || head === undefined || commandName(head) !== "cd")
    return {};
  const values = tokens[1] === "--" ? tokens.slice(2) : tokens.slice(1);
  const [target] = values;
  if (values.length !== 1 || target === undefined)
    return { reason: "cd target is absent or ambiguous" };
  if (/[$`*?{}<>]/.test(target))
    return { reason: "cd target contains unresolved shell expansion" };
  if (isAbsolute(target)) return { directory: resolve(target) };
  if (directory === undefined) {
    return {
      reason: "relative cd target follows an unresolved working directory",
    };
  }
  return { directory: resolve(directory, target) };
}

export function shellCommandSegmentsWithDirectory(
  command: string,
  initialDirectory: string,
): ShellCommandSegmentWithDirectory[] {
  const segments = shellCommandSegments(command);
  const result: ShellCommandSegmentWithDirectory[] = [];
  let directory: string | undefined = resolve(initialDirectory);
  let directoryReason: string | undefined;
  let pendingCd:
    | {
        before?: string;
        beforeReason?: string;
        target?: string;
        reason?: string;
      }
    | undefined;
  // Parent states of open subshells, innermost last. A `cd` inside `( ... )`
  // only affects segments up to the matching `)`: the outer state resumes
  // after it, and a cd as the last subshell command never reaches the next
  // command. States, not just directories: an ambiguous parent stays
  // ambiguous after the group closes.
  const subshellStates: Array<{ directory?: string; reason?: string }> = [];

  // Apply a pending `cd` according to the operator linking it to what
  // follows. `&&` guarantees the cd succeeded (its target applies, or its
  // unresolved reason); `||` means the next segment only runs after a
  // FAILURE, so the directory is still the pre-cd one; any other separator
  // (`;`, `|`, `&`, plain adjacency) leaves both outcomes live.
  const applyPendingCd = (operator: string | undefined): void => {
    if (pendingCd === undefined) return;
    if (operator === "&&") {
      if (pendingCd.target !== undefined) {
        directory = pendingCd.target;
        directoryReason = undefined;
      } else {
        directory = undefined;
        directoryReason =
          pendingCd.reason ?? "preceding cd target is unresolved";
      }
    } else if (operator === "||") {
      directory = pendingCd.before;
      directoryReason = pendingCd.beforeReason;
    } else {
      directory = undefined;
      directoryReason =
        "working directory after cd is conditional or ambiguous";
    }
    pendingCd = undefined;
  };

  // A `(` opens a subshell that inherits the parent state at that moment.
  // The pushed restore point is that same post-cd parent state, so
  // `cd sub && ( … ) && cmd` resumes in sub, not in the pre-cd directory.
  const openSubshell = (): void => {
    if (pendingCd !== undefined) {
      // The cd sits immediately before the `(` with no operator between:
      // the group may start in either directory.
      directory = undefined;
      directoryReason =
        "subshell follows cd without a success or failure operator; its working directory is ambiguous";
      pendingCd = undefined;
    }
    subshellStates.push({
      ...(directory === undefined ? {} : { directory }),
      ...(directoryReason === undefined ? {} : { reason: directoryReason }),
    });
  };

  const closeSubshell = (): void => {
    const restore = subshellStates.pop();
    if (restore !== undefined) {
      directory = restore.directory;
      directoryReason = restore.reason;
    }
    pendingCd = undefined;
  };

  for (const segment of segments) {
    applyPendingCd(segment.preceding);
    result.push({
      ...segment,
      ...(directory === undefined
        ? {
            directoryReason:
              directoryReason ?? "working directory is unresolved",
          }
        : { directory }),
    });
    const [head] = segment.tokens;
    if (head === undefined) {
      // Paren marker: a grouping event with no command of its own.
      if (segment.endedBy === "(") openSubshell();
      else if (segment.endedBy === ")") closeSubshell();
      continue;
    }
    if (commandName(head) === "cd") {
      const target = cdTarget(segment.tokens, directory);
      pendingCd = {
        ...(directory === undefined ? {} : { before: directory }),
        ...(directoryReason === undefined
          ? {}
          : { beforeReason: directoryReason }),
        ...(target.directory === undefined ? {} : { target: target.directory }),
        ...(target.reason === undefined ? {} : { reason: target.reason }),
      };
    }
    if (segment.endedBy === "(") openSubshell();
    else if (segment.endedBy === ")") closeSubshell();
  }
  return result;
}

function commandName(value: string): string {
  return basename(value);
}
