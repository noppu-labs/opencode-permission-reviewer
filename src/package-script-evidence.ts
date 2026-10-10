import { sourceCommand } from "./evidence/source-command.ts";
import { scriptCalls } from "./package-script-calls.ts";
import { ScriptExpansion } from "./package-script-expansion.ts";
import {
  MAX_SCRIPT_RECORDS,
  type ScriptRecord,
} from "./package-script-records.ts";
import type { PermissionRequest } from "./types.ts";
import { shellCommandSegmentsWithDirectory } from "./working-directory-segments.ts";

function serializeRecords(records: ScriptRecord[]): string {
  return JSON.stringify(
    {
      coverage:
        "manifest definitions and literal local calls only; imported code and runtime configuration may add effects",
      status:
        records.length >= MAX_SCRIPT_RECORDS ||
        records.some((record) => record.status !== "included")
          ? "partial"
          : "included",
      ...(records.length >= MAX_SCRIPT_RECORDS
        ? { expansionLimitReached: true }
        : {}),
      records,
    },
    null,
    2,
  );
}

function boundedText(records: ScriptRecord[], maxChars: number): string {
  // Records are only popped while more than one remains, so `first` stays
  // records[0] from here on.
  const [first] = records;
  if (first === undefined) return "";
  let text = serializeRecords(records);
  // Drop whole records before shortening a record, retaining explicit gaps.
  while (text.length > maxChars && records.length > 1) {
    records.pop();
    first.status = "truncated";
    first.reason = "additional script evidence exceeded the character budget";
    text = serializeRecords(records);
  }
  if (text.length > maxChars) {
    delete first.referencedCode;
    if (first.command !== undefined)
      first.command = first.command.slice(0, Math.max(0, maxChars - 1_000));
    first.status = "truncated";
    first.reason = "script evidence exceeded the character budget";
    text = serializeRecords(records);
  }
  if (text.length > maxChars)
    text = JSON.stringify({
      status: "truncated",
      reason: "script evidence exceeded the character budget",
    });
  return `PACKAGE_SCRIPT_ANALYSIS\n${text}`;
}

/** Read manifest definitions and literal local calls; never execute package code. */
export async function enrichPackageScriptEvidence(
  request: PermissionRequest,
  directory: string,
  worktree: string,
  maxChars: number,
): Promise<{ text: string }> {
  if (request.permission !== "bash") return { text: "" };
  const expansion = new ScriptExpansion(request, {
    directory,
    worktree,
    maxChars,
  });
  for (const segment of shellCommandSegmentsWithDirectory(
    sourceCommand(request),
    directory,
  )) {
    for (const call of scriptCalls(segment.tokens)) {
      // biome-ignore lint/performance/noAwaitInLoops: expands top-level script calls in command order into the shared records list and MAX_SCRIPT_RECORDS budget; overlapping visits would reorder records and race the budget check
      await expansion.visit(call, segment.directory, 0);
    }
  }
  return { text: boundedText(expansion.records, maxChars) };
}
