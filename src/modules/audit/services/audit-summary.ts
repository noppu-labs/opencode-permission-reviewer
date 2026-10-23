// The audit report's summary of an audit file's tail: line and record counts,
// the per-record tallies, and the unknown actors.
import type { AuditTail } from "../repositories/audit-files.ts";
import { type AuditTally, emptyCounts, tallyRecord } from "./audit-tally.ts";

export interface AuditSummary extends AuditTally {
  path: string;
  exists: boolean;
  /** True when only the bounded tail (most recent 64 MiB) was summarized:
   *  line counts and timestamps then describe that window, not the file. */
  truncated: boolean;
  totalLines: number;
  validRecords: number;
  invalidLines: number;
  unknownActorNames: Array<{ name: string; count: number }>;
}

type AuditLine = Record<string, unknown>;

/** The line as a record, or undefined for bad JSON and for a bare primitive,
 *  null or array, which are not audit records. */
function parseAuditLine(line: string): AuditLine | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return undefined;
  return parsed as AuditLine;
}

/** The name an unknown actor is reported under, or undefined for a known
 *  actor (one with both a profile other than "unknown" and a name). */
function unknownActorName(record: AuditLine): string | undefined {
  const actor =
    typeof record.actor === "object" && record.actor !== null
      ? (record.actor as { name?: string; profile?: string })
      : undefined;
  const isUnknown =
    actor === undefined ||
    actor.profile === undefined ||
    actor.profile === "unknown" ||
    actor.name === undefined ||
    actor.name === "";
  if (!isUnknown) return undefined;
  const rawName =
    actor?.name ??
    (record.actor === undefined ? "(no actor field)" : "(unnamed)");
  // A hostile or corrupted record can put anything in `name`; coerce to a
  // string before the names are sorted.
  return typeof rawName === "string" ? rawName : JSON.stringify(rawName);
}

/** The unknown actor names by descending count, ties by name. */
function rankActorNames(
  actorCounts: Map<string, number>,
): Array<{ name: string; count: number }> {
  return [...actorCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}

function countRecord(
  summary: AuditSummary,
  record: AuditLine,
  lineNo: number,
  actorCounts: Map<string, number>,
): void {
  summary.validRecords++;
  tallyRecord(summary, record, lineNo);
  const name = unknownActorName(record);
  if (name !== undefined)
    actorCounts.set(name, (actorCounts.get(name) ?? 0) + 1);
}

/** Summarize the tail read from `path`; a missing tail (an unreadable file)
 *  gives the empty summary with `exists: false`. */
export function summarizeAuditTail(
  path: string,
  read: AuditTail | undefined,
): AuditSummary {
  const summary: AuditSummary = {
    path,
    exists: false,
    truncated: false,
    totalLines: 0,
    validRecords: 0,
    invalidLines: 0,
    bySchemaVersion: emptyCounts(),
    byHostGeneration: emptyCounts(),
    byApplication: emptyCounts(),
    byOutcome: emptyCounts(),
    byRiskLevel: emptyCounts(),
    byDecisionSource: emptyCounts(),
    byPermission: emptyCounts(),
    byHandoffTrigger: emptyCounts(),
    byResolution: emptyCounts(),
    unknownActorNames: [],
    missingRequiredFields: [],
  };
  if (read === undefined) return summary;
  summary.exists = true;
  summary.truncated = read.truncated;
  const lines = read.text.split("\n").filter((line) => line.trim().length > 0);
  summary.totalLines = lines.length;
  const actorCounts = new Map<string, number>();
  for (const [i, line] of lines.entries()) {
    const record = parseAuditLine(line);
    if (record === undefined) summary.invalidLines++;
    else countRecord(summary, record, i + 1, actorCounts);
  }
  summary.unknownActorNames = rankActorNames(actorCounts);
  return summary;
}
