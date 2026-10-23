// Shell command segments with the working directory tracked across cd chains and subshell groups,
// shared by the ssh, local-script, package-script and git evidence.

import { basename, resolve } from "node:path";
import { commandSegments } from "./command-segments.ts";
import {
  applyGrouping,
  applyPendingCd,
  type DirectoryTracker,
  recordCd,
} from "./directory-tracker.ts";

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
  for (const segment of commandSegments(command)) {
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
    if (head !== undefined && basename(head) === "cd")
      recordCd(tracker, segment.tokens);
    applyGrouping(tracker, segment.endedBy);
  }
  return result;
}
