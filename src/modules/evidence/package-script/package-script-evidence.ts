import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import { shellCommandSegmentsWithDirectory } from "../../analysis/walk/working-directory-segments.ts";
import { sourceCommand } from "../providers/source-command.ts";
import { scriptCalls } from "./package-script-calls.ts";
import { ScriptExpansion } from "./package-script-expansion.ts";
import {
  MAX_SCRIPT_RECORDS,
  type ScriptRecord,
} from "./package-script-records.ts";

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

/**
 * The directory the host runs the shell command in. A relative workdir resolves
 * against the session directory and is followed to its real path, because
 * package managers search parent manifests physically. A workdir that is not an
 * existing directory is undefined, so another directory's manifest is never
 * reported as the target.
 */
async function shellWorkdir(
  request: PermissionRequest,
  directory: string,
): Promise<string | undefined> {
  const input = request.metadata.toolInput;
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return directory;
  const workdir = (input as Record<string, unknown>).workdir;
  if (
    workdir === undefined ||
    (typeof workdir === "string" && workdir.trim() === "")
  )
    return directory;
  if (typeof workdir !== "string" || workdir.includes("\0")) return undefined;
  const resolved = resolve(directory, workdir);
  if (resolved === resolve(directory)) return directory;
  try {
    const real = await realpath(resolved);
    return (await stat(real)).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

/** Read manifest definitions and literal local calls; never execute package code. */
export async function enrichPackageScriptEvidence(
  request: PermissionRequest,
  directory: string,
  worktree: string,
  maxChars: number,
): Promise<{ text: string }> {
  if (request.permission !== "bash") return { text: "" };
  // The workdir only selects the starting manifest; reads stay within the approved roots.
  const workdir = await shellWorkdir(request, directory);
  const expansion = new ScriptExpansion(request, {
    directory,
    worktree,
    maxChars,
  });
  for (const segment of shellCommandSegmentsWithDirectory(
    sourceCommand(request),
    workdir ?? directory,
  )) {
    for (const call of scriptCalls(segment.tokens)) {
      // biome-ignore lint/performance/noAwaitInLoops: expands top-level script calls in command order into the shared records list and MAX_SCRIPT_RECORDS budget; overlapping visits would reorder records and race the budget check
      await expansion.visit(
        call,
        workdir === undefined ? undefined : segment.directory,
        0,
      );
    }
  }
  return { text: boundedText(expansion.records, maxChars) };
}
