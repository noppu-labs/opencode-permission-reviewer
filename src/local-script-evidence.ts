import { basename, resolve } from "node:path";
import { localExecutableCommand } from "./evidence/local-command.ts";
import { sourceCommand } from "./evidence/source-command.ts";
import { includeEvidenceFile } from "./evidence-file-reader.ts";
import type { FileEvidence } from "./file-evidence.ts";
import { scriptPath } from "./interpreter-script-target.ts";
import { localScriptText, recordFor } from "./local-script-record.ts";
import type { PermissionRequest } from "./types.ts";
import {
  type ShellCommandSegmentWithDirectory,
  shellCommandSegmentsWithDirectory,
} from "./working-directory-segments.ts";

export interface LocalScriptEnrichmentResult {
  text: string;
}

const INTERPRETERS = new Set([
  "python",
  "python3",
  "node",
  "bun",
  "deno",
  "tsx",
  "bash",
  "sh",
  "zsh",
  "ruby",
  "perl",
]);

interface InterpreterScript {
  interpreter: string;
  path: string;
}

function interpreterScript(tokens: string[]): InterpreterScript | undefined {
  const command = localExecutableCommand(tokens)?.tokens;
  const executable = command?.[0];
  if (
    command === undefined ||
    executable === undefined ||
    !INTERPRETERS.has(basename(executable))
  )
    return;
  const interpreter = basename(executable);
  const path = scriptPath(command, 0, interpreter);
  return path ? { interpreter, path } : undefined;
}

// A relative script after an unresolved cd has no known location.
function unlocated(
  segment: ShellCommandSegmentWithDirectory,
  path: string,
): boolean {
  return segment.directory === undefined && !path.startsWith("/");
}

function scriptKey(
  script: InterpreterScript,
  segment: ShellCommandSegmentWithDirectory,
  directory: string,
): string {
  return `${script.interpreter}\0${unlocated(segment, script.path) ? `unresolved:${script.path}` : resolve(segment.directory ?? directory, script.path)}`;
}

function unlocatedEvidence(
  path: string,
  segment: ShellCommandSegmentWithDirectory,
): FileEvidence {
  return {
    source: "file",
    path,
    status: "unavailable",
    reason: segment.directoryReason ?? "working directory is unresolved",
  };
}

export async function enrichLocalScriptEvidence(
  request: PermissionRequest,
  directory: string,
  worktree: string,
  maxChars: number,
): Promise<LocalScriptEnrichmentResult> {
  if (request.permission !== "bash") return { text: "" };
  const segments = shellCommandSegmentsWithDirectory(
    sourceCommand(request),
    directory,
  );
  const records: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    const script = interpreterScript(segment.tokens);
    if (script === undefined) continue;
    const key = scriptKey(script, segment, directory);
    if (seen.has(key)) continue;
    seen.add(key);
    const file = unlocated(segment, script.path)
      ? unlocatedEvidence(script.path, segment)
      : // biome-ignore lint/performance/noAwaitInLoops: kept sequential on the evidence trust path: the segment count comes from the reviewed command, so one script evidence file is open at a time (includeEvidenceFile closes its handle and retries a missing file once after 100 ms); records are appended in command order
        await includeEvidenceFile(
          script.path,
          segment.directory ?? directory,
          directory,
          worktree,
          maxChars,
        );
    records.push(recordFor(script.interpreter, file.path, file));
  }

  return { text: localScriptText(records, maxChars) };
}
