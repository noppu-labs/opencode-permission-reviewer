// Package script evidence records: the shared shape, the record budget, the
// script a manifest defines, and a builder for each record kind (included,
// unresolved, undefined script, cycle or depth stop).

import type { ManifestEvidence } from "./package-manifest-search.ts";
import type { ScriptInvocation } from "./package-script-invocation.ts";

export const MAX_SCRIPT_RECORDS = 16;

export interface ScriptRecord {
  manager: string;
  script: string;
  directory?: string;
  manifest?: string;
  phase?: string;
  command?: string;
  arguments?: string[];
  status: "included" | "unavailable" | "blocked" | "truncated" | "cycle";
  reason?: string;
  referencedCode?: string;
}

export type RecordBase = Pick<
  ScriptRecord,
  "manager" | "script" | "arguments" | "phase"
>;

export function recordBase(call: ScriptInvocation, phase: string): RecordBase {
  return {
    manager: call.manager,
    script: call.script,
    arguments: call.arguments,
    phase,
  };
}

export function definedScript(
  pkg: ManifestEvidence,
  script: string,
): string | undefined {
  if (
    !pkg.scripts ||
    !Object.hasOwn(pkg.scripts, script) ||
    typeof pkg.scripts[script] !== "string"
  )
    return;
  return pkg.scripts[script] as string;
}

export function unresolvedRecord(
  base: RecordBase,
  call: ScriptInvocation,
): ScriptRecord {
  return {
    ...base,
    status: "unavailable",
    reason: call.unresolved ?? "script working directory is unresolved",
  };
}

export function undefinedScriptRecord(
  base: RecordBase,
  cwd: string,
  pkg: ManifestEvidence,
): ScriptRecord {
  return {
    ...base,
    directory: cwd,
    manifest: pkg.path,
    status: pkg.status === "included" ? "unavailable" : pkg.status,
    reason: pkg.reason ?? "requested manifest script is not defined",
  };
}

export function expansionStopRecord(
  base: RecordBase,
  cwd: string,
  manifest: string,
  cycle: boolean,
): ScriptRecord {
  return {
    ...base,
    directory: cwd,
    manifest,
    status: cycle ? "cycle" : "truncated",
    reason: "script expansion reached a cycle or depth limit",
  };
}

export function includedRecord(
  base: RecordBase,
  directory: string,
  manifest: string,
  command: string,
): ScriptRecord {
  return { ...base, directory, manifest, command, status: "included" };
}
