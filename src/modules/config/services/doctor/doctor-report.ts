// The `doctor` report's shape and its human rendering on stderr.
import type { ReviewerConfig } from "../../../../types.ts";
import type { SourceInfo } from "../../controllers/config-sources.ts";

export interface DoctorReport {
  mode: "connected" | "local-only";
  host: { binaryVersion: string | null; runtime: unknown };
  version: {
    package: string | undefined;
    opencodeRange: string;
    runtime: string;
  };
  config: {
    global: SourceInfo;
    project: SourceInfo;
    model: ReviewerConfig["model"];
    enforcementMode: ReviewerConfig["enforcementMode"];
    repositoryTrust: ReviewerConfig["repositoryTrust"];
    policyRuleCount: number;
    effectivePolicyHash: string;
    configWarnings: string[];
    configDegraded: string[];
  };
  audit: { path: string; writable: boolean; error?: string };
}

export function printDoctorHuman(report: DoctorReport): void {
  const { config, audit } = report;
  console.error(
    `opencode-permission-reviewer doctor ${report.version.package}`,
  );
  console.error(`diagnostic mode: ${report.mode}`);
  console.error(`version`);
  console.error(`  package:    ${report.version.package}`);
  console.error(
    `  opencode:   ${report.version.opencodeRange} (engines.opencode)`,
  );
  console.error(`  runtime:    ${report.version.runtime}`);
  console.error(`config`);
  console.error(`  global:     ${fmtSource(config.global)}`);
  console.error(`  project:    ${fmtSource(config.project)}`);
  console.error(`  model:      ${config.model}`);
  // The mode gates declarative rules only; the reviewer still auto-allows or denies.
  const modeNote =
    config.enforcementMode === "observe"
      ? "declarative rules audited only; reviewer auto-allow/deny remains active"
      : "declarative rules enforced; reviewer decisions unchanged";
  console.error(`  mode:       ${config.enforcementMode} (${modeNote})`);
  console.error(`  trust:      ${config.repositoryTrust}`);
  console.error(
    `  rules:      ${config.policyRuleCount} (effectivePolicyHash: ${config.effectivePolicyHash})`,
  );
  printEntries("warning", config.configWarnings);
  printEntries("degraded", config.configDegraded);
  console.error(`audit`);
  console.error(`  path:       ${audit.path}`);
  console.error(
    `  writable:   ${audit.writable ? "yes" : "no"}${audit.error ? ` (${audit.error})` : ""}`,
  );
}

/** One labelled line per entry, so a healthy config prints none. */
function printEntries(label: string, entries: string[]): void {
  for (const entry of entries) {
    console.error(`  ${`${label}:`.padEnd(12)}${entry}`);
  }
}

function fmtSource(s: SourceInfo): string {
  return `${s.path}  exists=${s.exists ? "yes" : "no"}  sha256=${s.sha256 ?? "-"}`;
}
