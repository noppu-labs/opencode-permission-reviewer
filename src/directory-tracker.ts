// Working-directory state across one command's segments: pending `cd`s, the operators that decide
// whether they apply, and subshell groups that save and restore the parent state.

import { basename, isAbsolute, resolve } from "node:path";

interface PendingCd {
  before?: string;
  beforeReason?: string;
  target?: string;
  reason?: string;
}

export interface DirectoryTracker {
  directory: string | undefined;
  directoryReason: string | undefined;
  pendingCd: PendingCd | undefined;
  // Parent states of open subshells, innermost last. A `cd` inside `( ... )`
  // only affects segments up to the matching `)`: the outer state resumes
  // after it, and a cd as the last subshell command never reaches the next
  // command. States, not just directories: an ambiguous parent stays
  // ambiguous after the group closes.
  subshellStates: Array<{ directory?: string; reason?: string }>;
}

// Apply a pending `cd` according to the operator linking it to what
// follows. `&&` guarantees the cd succeeded (its target applies, or its
// unresolved reason); `||` means the next segment only runs after a
// FAILURE, so the directory is still the pre-cd one; any other separator
// (`;`, `|`, `&`, plain adjacency) leaves both outcomes live.
export function applyPendingCd(
  tracker: DirectoryTracker,
  operator: string | undefined,
): void {
  const pendingCd = tracker.pendingCd;
  if (pendingCd === undefined) return;
  if (operator === "&&") {
    applySucceededCd(tracker, pendingCd);
  } else if (operator === "||") {
    tracker.directory = pendingCd.before;
    tracker.directoryReason = pendingCd.beforeReason;
  } else {
    tracker.directory = undefined;
    tracker.directoryReason =
      "working directory after cd is conditional or ambiguous";
  }
  tracker.pendingCd = undefined;
}

function applySucceededCd(
  tracker: DirectoryTracker,
  pendingCd: PendingCd,
): void {
  if (pendingCd.target !== undefined) {
    tracker.directory = pendingCd.target;
    tracker.directoryReason = undefined;
  } else {
    tracker.directory = undefined;
    tracker.directoryReason =
      pendingCd.reason ?? "preceding cd target is unresolved";
  }
}

// A `(` opens a subshell that inherits the parent state at that moment.
// The pushed restore point is that same post-cd parent state, so
// `cd sub && ( … ) && cmd` resumes in sub, not in the pre-cd directory.
function openSubshell(tracker: DirectoryTracker): void {
  if (tracker.pendingCd !== undefined) {
    // The cd sits immediately before the `(` with no operator between:
    // the group may start in either directory.
    tracker.directory = undefined;
    tracker.directoryReason =
      "subshell follows cd without a success or failure operator; its working directory is ambiguous";
    tracker.pendingCd = undefined;
  }
  tracker.subshellStates.push({
    ...(tracker.directory === undefined
      ? {}
      : { directory: tracker.directory }),
    ...(tracker.directoryReason === undefined
      ? {}
      : { reason: tracker.directoryReason }),
  });
}

function closeSubshell(tracker: DirectoryTracker): void {
  const restore = tracker.subshellStates.pop();
  if (restore !== undefined) {
    tracker.directory = restore.directory;
    tracker.directoryReason = restore.reason;
  }
  tracker.pendingCd = undefined;
}

export function applyGrouping(
  tracker: DirectoryTracker,
  endedBy: string | undefined,
): void {
  if (endedBy === "(") openSubshell(tracker);
  else if (endedBy === ")") closeSubshell(tracker);
}

export function recordCd(tracker: DirectoryTracker, tokens: string[]): void {
  const { directory, directoryReason } = tracker;
  const target = cdTarget(tokens, directory);
  tracker.pendingCd = {
    ...(directory === undefined ? {} : { before: directory }),
    ...(directoryReason === undefined ? {} : { beforeReason: directoryReason }),
    ...(target.directory === undefined ? {} : { target: target.directory }),
    ...(target.reason === undefined ? {} : { reason: target.reason }),
  };
}

function cdTarget(
  tokens: string[],
  directory: string | undefined,
): { directory?: string; reason?: string } {
  const [head] = tokens;
  if (tokens.length < 2 || head === undefined || basename(head) !== "cd")
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
