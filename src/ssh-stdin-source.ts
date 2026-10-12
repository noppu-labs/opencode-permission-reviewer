// The file a pipeline feeds into ssh's stdin: its producing command, the evidence read for it, and the
// preflight denial when it is missing.

import { isAbsolute } from "node:path";
import type { EvidenceScope } from "./evidence/provider.ts";
import { includeEvidenceFile } from "./evidence-file-reader.ts";
import { type FileEvidence, isMissingFile } from "./file-evidence.ts";
import { catSource } from "./ssh-command-segments.ts";
import type { ShellCommandSegmentWithDirectory } from "./working-directory-segments.ts";

// The pipeline producer runs where IT runs, not where ssh runs: a group
// like `(cd sub && cat p.py) | ssh …` reads the stdin file from sub even
// though ssh itself executes in the outer directory. Walk back over
// paren markers to the producing command.
// A negative index reads `undefined`, which ends the walk at the start.
export function pipelineProducer(
  segments: ShellCommandSegmentWithDirectory[],
  segmentIndex: number,
): ShellCommandSegmentWithDirectory | undefined {
  let producerIndex = segmentIndex - 1;
  let producer = segments[producerIndex];
  while (producer !== undefined && producer.tokens.length === 0) {
    producerIndex -= 1;
    producer = segments[producerIndex];
  }
  return producer;
}

export async function stdinEvidence(
  segment: ShellCommandSegmentWithDirectory,
  producer: ShellCommandSegmentWithDirectory | undefined,
  scope: EvidenceScope,
): Promise<FileEvidence | undefined> {
  const stdinPath =
    segment.preceding === "|" && producer
      ? catSource(producer.tokens)
      : undefined;
  if (stdinPath === undefined) return undefined;
  if (
    producer !== undefined &&
    producer.directory === undefined &&
    !isAbsolute(stdinPath)
  ) {
    return {
      source: "file",
      path: stdinPath,
      status: "unavailable",
      reason:
        producer.directoryReason ??
        "working directory of the pipeline producer is unresolved",
    };
  }
  return includeEvidenceFile(
    stdinPath,
    producer?.directory ?? segment.directory ?? scope.directory,
    scope.directory,
    scope.worktree,
    scope.maxChars,
  );
}

export function deterministicDenial(
  stdin: FileEvidence | undefined,
): string | undefined {
  if (!stdin) return;
  if (isMissingFile(stdin)) {
    return `The file sent over stdin does not exist after a second check: ${stdin.path}. Create it and retry the command.`;
  }
  return;
}
