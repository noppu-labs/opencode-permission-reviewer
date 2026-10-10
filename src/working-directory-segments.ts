// Shell command segments with the working directory tracked across cd chains and subshell groups,
// shared by the ssh, local-script, package-script and git evidence.

import { basename, resolve } from "node:path";
import {
  applyGrouping,
  applyPendingCd,
  type DirectoryTracker,
  recordCd,
} from "./directory-tracker.ts";
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

export function shellCommandSegmentsWithDirectory(
  command: string,
  initialDirectory: string,
): ShellCommandSegmentWithDirectory[] {
  const tracker: DirectoryTracker = {
    directory: resolve(initialDirectory),
    directoryReason: undefined,
    pendingCd: undefined,
    subshellStates: [],
  };
  const result: ShellCommandSegmentWithDirectory[] = [];
  for (const segment of shellCommandSegments(command)) {
    applyPendingCd(tracker, segment.preceding);
    result.push({
      ...segment,
      ...(tracker.directory === undefined
        ? {
            directoryReason:
              tracker.directoryReason ?? "working directory is unresolved",
          }
        : { directory: tracker.directory }),
    });
    // A paren marker has no tokens: a grouping event with no command of its own.
    const [head] = segment.tokens;
    if (head !== undefined && commandName(head) === "cd")
      recordCd(tracker, segment.tokens);
    applyGrouping(tracker, segment.endedBy);
  }
  return result;
}

function commandName(value: string): string {
  return basename(value);
}
