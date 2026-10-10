// Depth-first expansion of manifest scripts into evidence records: lifecycle
// hooks, referenced local scripts and nested package-manager calls, under the
// cycle, depth and record bounds.

import { dirname } from "node:path";
import { enrichLocalScriptEvidence } from "./local-script-evidence.ts";
import {
  type EvidenceScope,
  ManifestCache,
} from "./package-manifest-search.ts";
import { scriptCalls } from "./package-script-calls.ts";
import type { ScriptInvocation } from "./package-script-invocation.ts";
import {
  definedScript,
  expansionStopRecord,
  includedRecord,
  MAX_SCRIPT_RECORDS,
  type RecordBase,
  recordBase,
  type ScriptRecord,
  undefinedScriptRecord,
  unresolvedRecord,
} from "./package-script-records.ts";
import type { PermissionRequest } from "./types.ts";
import { shellCommandSegmentsWithDirectory } from "./working-directory-segments.ts";

const MAX_SCRIPT_DEPTH = 4;

// Expands one request's script calls into `records`, depth first in command
// order. Every visit appends to the shared records list, active-cycle set and
// MAX_SCRIPT_RECORDS budget, so visits run strictly one after another.
export class ScriptExpansion {
  readonly records: ScriptRecord[] = [];
  private readonly active = new Set<string>();
  private readonly manifests: ManifestCache;
  private readonly request: PermissionRequest;
  private readonly scope: EvidenceScope;

  constructor(request: PermissionRequest, scope: EvidenceScope) {
    this.manifests = new ManifestCache(scope);
    this.request = request;
    this.scope = scope;
  }

  async visit(
    call: ScriptInvocation,
    cwd: string | undefined,
    depth: number,
    phase = "requested",
  ): Promise<void> {
    if (this.records.length >= MAX_SCRIPT_RECORDS) return;
    const base = recordBase(call, phase);
    if (cwd === undefined || call.unresolved) {
      this.records.push(unresolvedRecord(base, call));
      return;
    }
    const pkg = await this.manifests.nearest(cwd);
    const command = definedScript(pkg, call.script);
    if (pkg.scripts === undefined || command === undefined) {
      this.records.push(undefinedScriptRecord(base, cwd, pkg));
      return;
    }
    const key = `${pkg.path}\0${call.script}`;
    if (this.active.has(key) || depth > MAX_SCRIPT_DEPTH) {
      this.records.push(
        expansionStopRecord(base, cwd, pkg.path, this.active.has(key)),
      );
      return;
    }
    this.active.add(key);
    await this.expand(call, base, pkg.path, pkg.scripts, command, depth);
    this.active.delete(key);
  }

  private async expand(
    call: ScriptInvocation,
    base: RecordBase,
    manifest: string,
    scripts: Record<string, unknown>,
    command: string,
    depth: number,
  ): Promise<void> {
    const pkgDirectory = dirname(manifest);
    const record = includedRecord(base, pkgDirectory, manifest, command);
    this.records.push(record);
    // Defined lifecycle hooks are evidence of possible execution, not a claim
    // that runtime flags or configuration necessarily enable them.
    if (base.phase === "requested")
      await this.visitHooks(call, scripts, pkgDirectory, depth);
    if (this.records.length < MAX_SCRIPT_RECORDS)
      await this.visitReferences(record, command, pkgDirectory, depth);
  }

  private async visitHooks(
    call: ScriptInvocation,
    scripts: Record<string, unknown>,
    pkgDirectory: string,
    depth: number,
  ): Promise<void> {
    for (const prefix of ["pre", "post"]) {
      const name = prefix + call.script;
      if (Object.hasOwn(scripts, name))
        // biome-ignore lint/performance/noAwaitInLoops: the pre hook must be expanded before the post hook; each visit appends to the shared records list and active-cycle set, so overlapping visits would reorder records and race the cycle check
        await this.visit(
          { manager: call.manager, script: name, arguments: [] },
          pkgDirectory,
          depth + 1,
          `conditional-${prefix}`,
        );
    }
  }

  private async visitReferences(
    record: ScriptRecord,
    command: string,
    pkgDirectory: string,
    depth: number,
  ): Promise<void> {
    const local = await enrichLocalScriptEvidence(
      { ...this.request, metadata: { command }, patterns: [command] },
      pkgDirectory,
      this.scope.worktree,
      Math.min(this.scope.maxChars, 8_000),
    );
    if (local.text) record.referencedCode = local.text;
    for (const segment of shellCommandSegmentsWithDirectory(
      command,
      pkgDirectory,
    )) {
      for (const child of scriptCalls(segment.tokens)) {
        // biome-ignore lint/performance/noAwaitInLoops: expands child script calls in command order into the shared records list, active-cycle set and MAX_SCRIPT_RECORDS budget; overlapping visits would reorder records and race the cycle and budget checks
        await this.visit(child, segment.directory, depth + 1);
      }
    }
  }
}
