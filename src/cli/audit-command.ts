// The `audit report` subcommand: summarise the JSONL audit trail as JSON or as a human report.
import { parseArgs } from "node:util";
import { expandHome, readAuditSummary, resolveAuditPath } from "../audit.ts";
import type { AuditSummary } from "../audit-summary.ts";
import { loadResolvedConfig } from "../config/loader.ts";

export async function runAudit(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      path: { type: "string" },
      project: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help || positionals[0] !== "report") {
    console.error(
      "Usage: audit report [--path <file>] [--project <dir>] [--json]",
    );
    return 2;
  }
  const directory = values.project ?? process.cwd();
  const config = loadResolvedConfig(undefined, directory);
  const auditPath = values.path
    ? expandHome(values.path)
    : resolveAuditPath(config);
  const summary = readAuditSummary(auditPath);
  if (!summary.exists) {
    console.error(`audit report: ${auditPath}: no such file`);
    return 1;
  }
  if (values.json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  printAuditHuman(summary);
  return 0;
}

function printAuditHuman(s: AuditSummary): void {
  console.log(`audit report: ${s.path}`);
  if (s.truncated) {
    console.log(
      "  NOTE: only the most recent 64 MiB were summarized; counts and",
    );
    console.log("  timestamps describe that tail, not the whole file.");
  }
  console.log(
    `  valid records:     ${s.validRecords} (invalid lines: ${s.invalidLines})`,
  );
  console.log(`  schema versions:   ${fmtCounts(s.bySchemaVersion)}`);
  console.log(`  host generations:  ${fmtCounts(s.byHostGeneration)}`);
  console.log(`  application states:${fmtCounts(s.byApplication)}`);
  if (s.firstTimestamp || s.lastTimestamp) {
    console.log(
      `  time range:        ${s.firstTimestamp ?? "?"} → ${s.lastTimestamp ?? "?"}`,
    );
  }
  printAuditCounts(s);
  printAuditProblems(s);
}

function printAuditCounts(s: AuditSummary): void {
  console.log(`  by outcome:        ${fmtCounts(s.byOutcome)}`);
  console.log(`  by risk level:     ${fmtCounts(s.byRiskLevel)}`);
  if (Object.keys(s.byDecisionSource).length > 0) {
    console.log(`  by decision source:${fmtCounts(s.byDecisionSource)}`);
  }
  if (Object.keys(s.byPermission).length > 0) {
    console.log(`  by permission:     ${fmtCounts(s.byPermission)}`);
  }
  if (Object.keys(s.byHandoffTrigger).length > 0) {
    console.log(`  by hand-off:       ${fmtCounts(s.byHandoffTrigger)}`);
  }
  if (Object.keys(s.byResolution).length > 0) {
    console.log(`  by resolution:     ${fmtCounts(s.byResolution)}`);
  }
}

function printAuditProblems(s: AuditSummary): void {
  if (s.unknownActorNames.length > 0) {
    console.log(`  unknown actors:    ${s.unknownActorNames.length}`);
    for (const a of s.unknownActorNames.slice(0, 10))
      console.log(`    ${a.name} (${a.count})`);
  }
  if (s.missingRequiredFields.length > 0) {
    console.log(`  missing required fields: ${s.missingRequiredFields.length}`);
    for (const m of s.missingRequiredFields.slice(0, 10)) {
      console.log(`    line ${m.lineNo}: missing ${m.missing.join(", ")}`);
    }
  }
}

function fmtCounts(map: Record<string, number>): string {
  const entries = Object.entries(map);
  if (entries.length === 0) return "(none)";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(" | ");
}
