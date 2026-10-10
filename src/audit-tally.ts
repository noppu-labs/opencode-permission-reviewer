// The per-record tallies of the audit summary: counts by field, timestamp
// bounds, and the records missing a required field.

/** The required identity/decision fields every audit record must carry. Used
 *  by the report reader to flag truncated or malformed lines. */
const REQUIRED_AUDIT_FIELDS = [
  "timestamp",
  "requestID",
  "sessionID",
  "permission",
  "outcome",
  "reason",
] as const;

const APPLICATIONS = [
  "evaluation-returned",
  "reply-accepted",
  "human-pending",
  "superseded",
  "cancelled",
  "unknown",
];

interface AuditMissingFields {
  lineNo: number;
  missing: string[];
}

/** The part of the summary each valid record adds to. */
export interface AuditTally {
  bySchemaVersion: Record<string, number>;
  byHostGeneration: Record<string, number>;
  byApplication: Record<string, number>;
  byOutcome: Record<string, number>;
  byRiskLevel: Record<string, number>;
  byDecisionSource: Record<string, number>;
  byPermission: Record<string, number>;
  missingRequiredFields: AuditMissingFields[];
  firstTimestamp?: string;
  lastTimestamp?: string;
}

type AuditLine = Record<string, unknown>;

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function countProvenance(tally: AuditTally, record: AuditLine): void {
  bump(tally.bySchemaVersion, String(record.schemaVersion ?? 1));
  bump(
    tally.byHostGeneration,
    record.hostGeneration === "v1" || record.hostGeneration === "v2"
      ? record.hostGeneration
      : "legacy-unspecified",
  );
  if (
    typeof record.application === "string" &&
    APPLICATIONS.includes(record.application)
  )
    bump(tally.byApplication, record.application);
}

function countDecision(tally: AuditTally, record: AuditLine): void {
  if (typeof record.outcome === "string") bump(tally.byOutcome, record.outcome);
  bump(
    tally.byRiskLevel,
    typeof record.riskLevel === "string" ? record.riskLevel : "(none)",
  );
  if (typeof record.decisionSource === "string")
    bump(tally.byDecisionSource, record.decisionSource);
  if (typeof record.permission === "string")
    bump(tally.byPermission, record.permission);
}

function trackTimestamps(tally: AuditTally, timestamp: unknown): void {
  if (typeof timestamp !== "string") return;
  if (tally.firstTimestamp === undefined || timestamp < tally.firstTimestamp) {
    tally.firstTimestamp = timestamp;
  }
  if (tally.lastTimestamp === undefined || timestamp > tally.lastTimestamp) {
    tally.lastTimestamp = timestamp;
  }
}

export function tallyRecord(
  tally: AuditTally,
  record: AuditLine,
  lineNo: number,
): void {
  countProvenance(tally, record);
  countDecision(tally, record);
  trackTimestamps(tally, record.timestamp);
  const missing = REQUIRED_AUDIT_FIELDS.filter((f) => record[f] === undefined);
  if (missing.length > 0) tally.missingRequiredFields.push({ lineNo, missing });
}
