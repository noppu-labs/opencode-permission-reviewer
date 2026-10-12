// The nearest package.json above a working directory, read through the
// evidence file reader and memoised per request, and the scripts table it
// defines.

import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceScope } from "./evidence/provider.ts";
import { includeEvidenceFile } from "./evidence-file-reader.ts";
import type { FileEvidence } from "./file-evidence.ts";

const MAX_MANIFEST_DEPTH = 8;

export interface ManifestEvidence {
  path: string;
  scripts?: Record<string, unknown>;
  reason?: string;
  status: FileEvidence["status"];
}

function pathExists(path: string): Promise<boolean> {
  return lstat(path)
    .then(() => true)
    .catch(() => false);
}

function scriptTable(json: unknown): Record<string, unknown> | undefined {
  const scripts =
    typeof json === "object" && json !== null && "scripts" in json
      ? json.scripts
      : undefined;
  return typeof scripts === "object" &&
    scripts !== null &&
    !Array.isArray(scripts)
    ? (scripts as Record<string, unknown>)
    : undefined;
}

function parsedManifest(path: string, content: string): ManifestEvidence {
  try {
    const scripts = scriptTable(JSON.parse(content));
    return {
      path,
      status: "included" as const,
      ...(scripts === undefined ? {} : { scripts }),
    };
  } catch {
    return {
      path,
      status: "unavailable" as const,
      reason: "manifest is not valid JSON",
    };
  }
}

async function manifestEvidence(
  path: string,
  cwd: string,
  scope: EvidenceScope,
): Promise<ManifestEvidence> {
  const file = await includeEvidenceFile(
    path,
    cwd,
    scope.directory,
    scope.worktree,
    Math.min(64_000, Math.max(scope.maxChars, 8_000)),
  );
  if (file.status !== "included" || file.content === undefined)
    return {
      path,
      status: file.status,
      reason: file.reason ?? "manifest content was not fully available",
    };
  return parsedManifest(path, file.content);
}

async function nearestManifest(
  cwd: string,
  scope: EvidenceScope,
): Promise<ManifestEvidence> {
  let cursor = cwd;
  for (let depth = 0; depth < MAX_MANIFEST_DEPTH; depth++) {
    const path = join(cursor, "package.json");
    // biome-ignore lint/performance/noAwaitInLoops: walks up one parent directory per step and returns at the nearest package.json, so a farther manifest must not be read before a closer one is ruled out
    if (await pathExists(path)) return await manifestEvidence(path, cwd, scope);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return {
    path: join(cwd, "package.json"),
    status: "unavailable" as const,
    reason: "no manifest found in the bounded parent search",
  };
}

// The nearest manifest per working directory, for one request. The pending
// search is stored as soon as it starts, so a directory is searched once.
export class ManifestCache {
  private readonly manifests = new Map<string, Promise<ManifestEvidence>>();
  private readonly scope: EvidenceScope;

  constructor(scope: EvidenceScope) {
    this.scope = scope;
  }

  nearest(cwd: string): Promise<ManifestEvidence> {
    const existing = this.manifests.get(cwd);
    if (existing) return existing;
    const pending = nearestManifest(cwd, this.scope);
    this.manifests.set(cwd, pending);
    return pending;
  }
}
