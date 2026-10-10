import { lstat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { elementAt } from "./element-at.ts";
import { sourceCommand } from "./evidence/source-command.ts";
import { includeEvidenceFile } from "./evidence-file-reader.ts";
import { enrichLocalScriptEvidence } from "./local-script-evidence.ts";
import { effectiveCommands } from "./shell-effective-commands.ts";
import type { PermissionRequest } from "./types.ts";
import { shellCommandSegmentsWithDirectory } from "./working-directory-segments.ts";

const MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);
const MAX_SCRIPT_DEPTH = 4;
const MAX_SCRIPT_RECORDS = 16;
const MAX_MANIFEST_DEPTH = 8;

interface ScriptInvocation {
  manager: string;
  script: string;
  arguments: string[];
  unresolved?: string;
}

interface ScriptRecord {
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

interface ManifestEvidence {
  path: string;
  scripts?: Record<string, unknown>;
  reason?: string;
  status: ScriptRecord["status"];
}

const DIRECTORY_SELECTION =
  /^(?:--(?:cwd|prefix|workspace|workspaces|filter)|-F|-C)(?:=|$)/;
const VALUED_MANAGER_OPTIONS = [
  "--cwd",
  "--prefix",
  "--workspace",
  "--filter",
  "-F",
  "-C",
];

interface OptionScan {
  cursor: number;
  ambiguous: boolean;
}

function skipManagerOptions(tokens: string[], scan: OptionScan): void {
  while (tokens[scan.cursor]?.startsWith("-")) {
    const option = elementAt(tokens, scan.cursor, "tokens");
    scan.cursor += 1;
    if (DIRECTORY_SELECTION.test(option)) scan.ambiguous = true;
    if (VALUED_MANAGER_OPTIONS.includes(option)) scan.cursor += 1;
  }
}

function lifecycleScript(subcommand: string | undefined): string | undefined {
  return ["test", "start", "stop", "restart"].includes(subcommand ?? "")
    ? subcommand
    : undefined;
}

function isScriptName(script: string | undefined): script is string {
  return (
    script !== undefined &&
    script !== "" &&
    !script.startsWith("-") &&
    !/[/$`*?{}<>]/.test(script) &&
    !/\.[cm]?[jt]sx?$/.test(script)
  );
}

function invocation(tokens: string[]): ScriptInvocation | undefined {
  const manager = basename(tokens[0] ?? "");
  if (!MANAGERS.has(manager)) return;
  const scan: OptionScan = { cursor: 1, ambiguous: false };
  skipManagerOptions(tokens, scan);
  const subcommand = tokens[scan.cursor];
  if (manager === "bun" && subcommand !== "run") return;
  const runs = subcommand === "run" || subcommand === "run-script";
  if (runs) {
    scan.cursor++;
    skipManagerOptions(tokens, scan);
  }
  const script = runs ? tokens[scan.cursor] : lifecycleScript(subcommand);
  if (!isScriptName(script)) return;
  return {
    manager,
    script,
    arguments: tokens.slice(scan.cursor + 1),
    ...(scan.ambiguous
      ? {
          unresolved:
            "runtime directory or workspace selection is not resolved",
        }
      : {}),
  };
}

const REMOTE_OR_PRIVILEGED = [
  "ssh",
  "chroot",
  "docker",
  "podman",
  "kubectl",
  "nsenter",
  "sudo",
  "su",
  "runuser",
  "systemd-run",
];

function scriptCalls(tokens: string[]): ScriptInvocation[] {
  const managerIndex = tokens.findIndex((token) =>
    MANAGERS.has(basename(token)),
  );
  const prefix = managerIndex < 0 ? tokens : tokens.slice(0, managerIndex);
  if (prefix.some((token) => REMOTE_OR_PRIVILEGED.includes(basename(token))))
    return [];
  const redirected = prefix.some(
    (token) => token === "-C" || token.startsWith("--chdir"),
  );
  const commands = effectiveCommands({
    tokens: tokens.map((value) => ({ raw: value, value })),
  }).map((command) => command.map((token) => token.value));
  const changesDirectory =
    redirected ||
    commands.some((command) =>
      ["cd", "pushd", "popd"].includes(command[0] ?? ""),
    );
  return commands.flatMap((command) => {
    const call = invocation(command);
    return call
      ? [
          {
            ...call,
            ...(changesDirectory
              ? {
                  unresolved: "wrapped script working directory is unresolved",
                }
              : {}),
          },
        ]
      : [];
  });
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

interface EvidenceScope {
  directory: string;
  worktree: string;
  maxChars: number;
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

type RecordBase = Pick<
  ScriptRecord,
  "manager" | "script" | "arguments" | "phase"
>;

function definedScript(
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

function unresolvedRecord(
  base: RecordBase,
  call: ScriptInvocation,
): ScriptRecord {
  return {
    ...base,
    status: "unavailable",
    reason: call.unresolved ?? "script working directory is unresolved",
  };
}

function undefinedScriptRecord(
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

function expansionStopRecord(
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

// Expands one request's script calls into `records`, depth first in command
// order. Every visit appends to the shared records list, active-cycle set and
// MAX_SCRIPT_RECORDS budget, so visits run strictly one after another.
class ScriptExpansion {
  readonly records: ScriptRecord[] = [];
  private readonly active = new Set<string>();
  private readonly manifests = new Map<string, Promise<ManifestEvidence>>();
  private readonly request: PermissionRequest;
  private readonly scope: EvidenceScope;

  constructor(request: PermissionRequest, scope: EvidenceScope) {
    this.request = request;
    this.scope = scope;
  }

  private manifest(cwd: string): Promise<ManifestEvidence> {
    const existing = this.manifests.get(cwd);
    if (existing) return existing;
    const pending = nearestManifest(cwd, this.scope);
    this.manifests.set(cwd, pending);
    return pending;
  }

  async visit(
    call: ScriptInvocation,
    cwd: string | undefined,
    depth: number,
    phase = "requested",
  ): Promise<void> {
    if (this.records.length >= MAX_SCRIPT_RECORDS) return;
    const base: RecordBase = {
      manager: call.manager,
      script: call.script,
      arguments: call.arguments,
      phase,
    };
    if (cwd === undefined || call.unresolved) {
      this.records.push(unresolvedRecord(base, call));
      return;
    }
    const pkg = await this.manifest(cwd);
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
    const record: ScriptRecord = {
      ...base,
      directory: pkgDirectory,
      manifest,
      command,
      status: "included",
    };
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
