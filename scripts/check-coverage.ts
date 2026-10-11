/**
 * Coverage gate. Parses the lcov.info produced by `bun test --coverage` and
 * enforces two thresholds:
 *
 *  - global line coverage >= MIN_GLOBAL_LINE_PCT
 *  - every safety-critical module at 100% line coverage
 *
 * Bun does not emit branch-coverage data in its lcov output (BRF/BRH are
 * absent), so this gate is line-only. Branch coverage is covered indirectly by
 * the adversarial test suite (characterization, policy-engine, decision,
 * emergency-brake) rather than by a numeric gate.
 *
 * Run via `bun run test:coverage`.
 */
import { existsSync, readFileSync } from "node:fs";

const LCOV_PATH = "coverage/lcov.info";
const MIN_GLOBAL_LINE_PCT = 90;

// Modules whose coverage is a safety invariant: a line drop here is a likely
// behavioral regression, not a cosmetic gap.
const CRITICAL_MODULES: ReadonlySet<string> = new Set([
  "src/decision.ts",
  "src/decision-gates.ts",
  "src/decision-schema.ts",
  "src/escalation.ts",
  "src/policy.ts",
  "src/policy/policy-engine.ts",
  "src/policy/policy-conditions.ts",
  "src/policy/profile-templates.ts",
  "src/emergency-brake.ts",
  "src/brake-arguments.ts",
  "src/brake-block-device.ts",
  "src/brake-device-copy.ts",
  "src/brake-device-tools.ts",
  "src/brake-find-root.ts",
  "src/brake-network-export.ts",
  "src/brake-rm-flags.ts",
  "src/brake-root-target.ts",
  "src/opencode/event-normalizer.ts",
  "src/opencode/reply-transport.ts",
  "src/redact.ts",
]);

interface FileCoverage {
  path: string;
  linesFound: number;
  linesHit: number;
}

function parseLcov(path: string): FileCoverage[] {
  if (!existsSync(path)) {
    console.error(`coverage: lcov report not found at ${path}`);
    console.error("run `bun run test:coverage` first.");
    process.exit(1);
  }
  const files: FileCoverage[] = [];
  let current: FileCoverage | null = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      current = { path: line.slice(3), linesFound: 0, linesHit: 0 };
    } else if (current && applyRecordLine(current, line)) {
      files.push(current);
      current = null;
    }
  }
  return files;
}

// Applies one line inside an SF record; returns true when the record ends.
function applyRecordLine(current: FileCoverage, line: string): boolean {
  if (line === "end_of_record") return true;
  const n = Number(line.slice(3));
  // Reject non-integer / negative values so a malformed report cannot
  // produce NaN totals that silently pass the threshold.
  if (!Number.isInteger(n) || n < 0) return false;
  if (line.startsWith("LF:")) current.linesFound += n;
  else if (line.startsWith("LH:")) current.linesHit += n;
  return false;
}

function pct(hit: number, found: number): number {
  return found > 0 ? (hit / found) * 100 : 100;
}

function filePct(f: FileCoverage): number {
  return pct(f.linesHit, f.linesFound);
}

function checkGlobal(files: FileCoverage[], failures: string[]): void {
  const totalFound = files.reduce((n, f) => n + f.linesFound, 0);
  const totalHit = files.reduce((n, f) => n + f.linesHit, 0);
  if (totalFound === 0) {
    // An empty or malformed lcov report must not false-pass as 100%.
    failures.push("lcov report contains no line coverage data (LF total is 0)");
  }
  const globalPct = pct(totalHit, totalFound);
  const shown = globalPct.toFixed(1);
  console.log(`coverage: global lines ${totalHit}/${totalFound} (${shown}%)`);
  if (globalPct < MIN_GLOBAL_LINE_PCT) {
    failures.push(`global line coverage ${shown}% < ${MIN_GLOBAL_LINE_PCT}%`);
  }
}

// Per-file listing, sorted by lowest coverage first (excludes 100%).
function printGaps(files: FileCoverage[]): void {
  const gaps = files
    .filter((f) => f.linesFound > 0 && filePct(f) < 100)
    .sort((a, b) => filePct(a) - filePct(b));
  if (gaps.length === 0) return;
  console.log("\n  files under 100% line coverage:");
  for (const f of gaps) {
    const p = filePct(f).toFixed(1).padStart(5);
    console.log(`    ${p}%  ${f.linesHit}/${f.linesFound}  ${f.path}`);
  }
}

// Safety-critical modules must be fully covered.
function checkCritical(files: FileCoverage[], failures: string[]): void {
  console.log("\n  safety-critical modules (require 100%):");
  for (const f of files) {
    if (!CRITICAL_MODULES.has(f.path)) continue;
    const p = filePct(f);
    const mark = p === 100 ? "ok" : "FAIL";
    console.log(`    [${mark}] ${p.toFixed(1)}%  ${f.path}`);
    if (p < 100) failures.push(`${f.path}: ${p.toFixed(1)}% (requires 100%)`);
  }

  // Report any critical module that produced no coverage record at all
  // (e.g. renamed or not exercised by any test).
  const covered = new Set(files.map((f) => f.path));
  for (const m of CRITICAL_MODULES) {
    if (!covered.has(m)) {
      failures.push(`${m}: no coverage record (not exercised by tests)`);
      console.log(`    [FAIL] missing  ${m}`);
    }
  }
}

function main(): void {
  const files = parseLcov(LCOV_PATH);
  const failures: string[] = [];
  checkGlobal(files, failures);
  printGaps(files);
  checkCritical(files, failures);

  if (failures.length > 0) {
    console.error(`\ncoverage: ${failures.length} gate failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\ncoverage: all gates passed.");
}

main();
