import { realpath } from "node:fs/promises";
import { sourceCommand } from "./evidence/source-command.ts";
import { approvedEvidenceRoots, isWithinRoot } from "./evidence-file-reader.ts";
import {
  boundedList,
  type PlannedGitActions,
  plannedActions,
} from "./git-command-plan.ts";
import { filterNeutralizationArgs } from "./git-filter-neutralization.ts";
import {
  type DefaultRemoteRecord,
  resolveRemoteTargets,
  sanitizeRemoteUrl,
} from "./git-remote-targets.ts";
import { runGit } from "./git-run.ts";
import type { PermissionRequest } from "./types.ts";

export interface GitEnrichmentResult {
  text: string;
}

interface ParsedStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  unmerged: string[];
}

const UNMERGED_STATUSES = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

function parseStatus(stdout: string): ParsedStatus {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## "));
  const branch =
    branchLine?.slice(3).split("...")[0]?.trim() || "<detached-or-unknown>";
  const status: ParsedStatus = {
    branch,
    staged: [],
    unstaged: [],
    untracked: [],
    unmerged: [],
  };
  for (const line of lines) {
    if (!line.startsWith("## ")) recordStatusLine(status, line);
  }
  return status;
}

function recordStatusLine(status: ParsedStatus, line: string): void {
  const x = line[0] ?? " ";
  const y = line[1] ?? " ";
  const path = line.slice(3);
  if (x === "?" && y === "?") {
    status.untracked.push(path);
    return;
  }
  if (UNMERGED_STATUSES.includes(x + y)) {
    status.unmerged.push(path);
    return;
  }
  if (x !== " ") status.staged.push(path);
  if (y !== " ") status.unstaged.push(path);
}

type RewriteEvidence =
  | { status: "unavailable"; reason: string }
  | {
      status: "available";
      base: string;
      head: string;
      commitsInRange: number;
      commitsAbsentFromRemoteTrackingRefs: number;
      commitsPresentInRemoteTrackingRefs: number;
      remoteTrackingRefs: { values: string[]; omitted: number };
      upstream?: string;
      note: string;
    };

async function rewriteEvidence(
  directory: string,
  planned: PlannedGitActions,
  neutralization: string[],
): Promise<RewriteEvidence | undefined> {
  if (!planned.commands.includes("rebase")) return undefined;
  const base = planned.rewriteBases[0];
  if (base === undefined || planned.rewriteBases.length !== 1)
    return {
      status: "unavailable",
      reason: "rebase range is not a single literal base",
    };
  const resolved = await runGit(
    directory,
    ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`],
    neutralization,
  );
  if (!resolved.ok)
    return {
      status: "unavailable",
      reason: "rebase base could not be resolved",
    };
  const sha = resolved.stdout.trim();
  if (!/^[a-f0-9]{40,64}$/.test(sha))
    return { status: "unavailable", reason: "rebase base is not a commit" };
  const range = `${sha}..HEAD`;
  const [total, local, refs, head, upstream] = await Promise.all([
    runGit(directory, ["rev-list", "--count", range], neutralization),
    runGit(
      directory,
      ["rev-list", "--count", range, "--not", "--remotes"],
      neutralization,
    ),
    runGit(
      directory,
      ["for-each-ref", "--format=%(refname)", "refs/remotes"],
      neutralization,
    ),
    runGit(directory, ["rev-parse", "HEAD"], neutralization),
    runGit(
      directory,
      ["rev-parse", "--symbolic-full-name", "@{upstream}"],
      neutralization,
    ),
  ]);
  if (!total.ok || !local.ok || !refs.ok || !head.ok)
    return {
      status: "unavailable",
      reason: "rewrite range or remote-tracking state could not be inspected",
    };
  const totalCount = Number(total.stdout.trim());
  const localCount = Number(local.stdout.trim());
  return {
    status: "available",
    base: sha,
    head: head.stdout.trim(),
    commitsInRange: totalCount,
    commitsAbsentFromRemoteTrackingRefs: localCount,
    commitsPresentInRemoteTrackingRefs: totalCount - localCount,
    remoteTrackingRefs: boundedList(
      refs.stdout.trim().split("\n").filter(Boolean),
      20,
    ),
    ...(upstream.ok ? { upstream: upstream.stdout.trim() } : {}),
    note: "read-only local snapshot; remote-tracking refs may be stale and absence is not proof of unpublished history",
  };
}

const UNRESOLVED_EXPANSION = /[$`*?{}<>]/;

function unresolved(values: string[]): string[] {
  return values.filter((value) => UNRESOLVED_EXPANSION.test(value));
}

type GitRun = Awaited<ReturnType<typeof runGit>>;

type Inspection =
  | {
      ok: true;
      gitDirectory: string;
      neutralization: string[];
      repositoryRoot: string;
      status: ParsedStatus;
    }
  | { ok: false; reason: string };

function unavailable(
  reason: string,
  planned: unknown,
  maxChars: number,
): GitEnrichmentResult {
  return {
    text: `GIT_STATE_ANALYSIS\n${JSON.stringify(
      { status: "unavailable", reason, planned },
      null,
      2,
    ).slice(0, maxChars)}`,
  };
}

export async function enrichGitEvidence(
  request: PermissionRequest,
  directory: string,
  maxChars: number,
  worktree?: string,
): Promise<GitEnrichmentResult> {
  if (request.permission !== "bash") return { text: "" };
  const command = sourceCommand(request);
  const planned = plannedActions(command, directory);
  if (!planned.relevant) return { text: "" };
  const publicPlanned = {
    ...planned,
    remoteCandidates: planned.remoteCandidates.map(sanitizeRemoteUrl),
  };
  const inspection = await verifiedInspection(planned, directory, worktree);
  if (!inspection.ok)
    return unavailable(inspection.reason, publicPlanned, maxChars);
  const serialized = JSON.stringify(
    await stateRecord(planned, inspection),
    null,
    2,
  );
  const bounded =
    serialized.length <= maxChars
      ? serialized
      : `${serialized.slice(0, maxChars)}\n<git_enrichment_truncated characters="${serialized.length - maxChars}" />`;
  return { text: `GIT_STATE_ANALYSIS\n${bounded}` };
}

async function verifiedInspection(
  planned: PlannedGitActions,
  directory: string,
  worktree: string | undefined,
): Promise<Inspection> {
  if (!planned.executionDirectory)
    return {
      ok: false,
      reason: planned.directoryReason ?? "Git directory is unresolved",
    };

  // The planned directory comes from the reviewed command itself (`cd`,
  // `git -C`), so it can never mint an inspection root. Git runs subprocesses
  // with that directory as cwd; without containment a `cd /other/repo &&`
  // prefix would inspect an unrelated repository. Only the session directory,
  // the worktree, and /tmp/opencode may be inspected, judged on real paths so
  // symlinks cannot bridge out. An unresolvable planned directory is treated
  // as outside: there is nothing to inspect that the review can vouch for.
  const gitDirectory = await realpath(planned.executionDirectory).catch(
    () => undefined,
  );
  if (gitDirectory === undefined)
    return {
      ok: false,
      reason: "planned Git directory does not resolve to a real path",
    };
  const roots = await approvedEvidenceRoots(directory, worktree);
  if (!roots.some((root) => isWithinRoot(gitDirectory, root)))
    return {
      ok: false,
      reason: "planned Git directory is outside approved enrichment roots",
    };
  let neutralization: string[];
  try {
    neutralization = await filterNeutralizationArgs(gitDirectory);
  } catch (error) {
    // Fail closed: without a verified config we cannot prove the inspection
    // would not run repository-configured filters, so no snapshot is taken.
    const reason = `unable to verify git conversion filters before inspection (${error instanceof Error ? error.message : String(error)})`;
    return { ok: false, reason: reason.slice(0, 1_000) };
  }
  return repositoryState(gitDirectory, roots, neutralization);
}

async function repositoryState(
  gitDirectory: string,
  roots: string[],
  neutralization: string[],
): Promise<Inspection> {
  // Resolve the repository root first and require it inside the approved
  // roots: git discovers repositories upward, so a working directory inside
  // an approved root can otherwise sit in a repository whose root, and whose
  // whole status/diff state, lies outside them. The window between this
  // realpath and the git subprocesses below cannot be eliminated (git takes
  // a path as cwd, not an open descriptor), but the reviewed command has not
  // run yet, so racing it requires a second concurrent process.
  const root = await runGit(
    gitDirectory,
    ["rev-parse", "--show-toplevel"],
    neutralization,
  );
  if (!root.ok) return { ok: false, reason: root.reason };
  const repositoryRoot = await realpath(root.stdout.trim()).catch(
    () => undefined,
  );
  if (
    repositoryRoot === undefined ||
    !roots.some((r) => isWithinRoot(repositoryRoot, r))
  )
    return {
      ok: false,
      reason: "repository root is outside approved enrichment roots",
    };

  const status = await runGit(
    gitDirectory,
    ["status", "--porcelain=v1", "--branch", "--untracked-files=normal"],
    neutralization,
  );
  if (!status.ok) return { ok: false, reason: status.reason };
  if (!/^## [^\r\n]+\r?\n/.test(status.stdout))
    return {
      ok: false,
      reason: "Git status output is incomplete: missing branch header",
    };
  return {
    ok: true,
    gitDirectory,
    neutralization,
    repositoryRoot: root.stdout.trim(),
    status: parseStatus(status.stdout),
  };
}

async function stateRecord(
  planned: PlannedGitActions,
  inspection: Extract<Inspection, { ok: true }>,
): Promise<Record<string, unknown>> {
  const { gitDirectory, neutralization, status: parsed } = inspection;
  const [mergeHead, rewrite] = await Promise.all([
    planned.commands.some((cmd) => ["add", "commit", "merge"].includes(cmd))
      ? runGit(
          gitDirectory,
          ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
          neutralization,
        )
      : undefined,
    rewriteEvidence(gitDirectory, planned, neutralization),
  ]);
  const remotes = await remoteRecord(gitDirectory, planned, neutralization);
  const targetDiff = await affectedTargetDiff(
    gitDirectory,
    planned,
    neutralization,
  );
  return {
    status: "available",
    repositoryRoot: inspection.repositoryRoot,
    branch: parsed.branch,
    plannedCommands: planned.commands,
    commitRequested: planned.commit,
    plannedAdd: boundedList(planned.plannedAdd),
    preexistingStaged: boundedList(parsed.staged),
    ...mergeIndexRecord(mergeHead),
    ...(parsed.unmerged.length > 0
      ? { unmerged: boundedList(parsed.unmerged) }
      : {}),
    ...(rewrite === undefined ? {} : { rewrite }),
    unstaged: boundedList(parsed.unstaged),
    untracked: boundedList(parsed.untracked),
    discardTargets: boundedList(planned.discardTargets),
    removeTargets: boundedList(planned.removeTargets),
    ...remotes,
    unresolvedPlannedPaths: boundedList(
      unresolved([
        ...planned.plannedAdd,
        ...planned.discardTargets,
        ...planned.removeTargets,
      ]),
    ),
    ...numstatRecord(targetDiff),
  };
}

function mergeIndexRecord(
  mergeHead: GitRun | undefined,
): Record<string, string> {
  return mergeHead?.ok
    ? {
        indexContext: "merge-result-index",
        mergeHead: mergeHead.stdout.trim(),
        note: "the current index includes the in-progress merge result; this does not establish ownership or approval of every staged change",
      }
    : {};
}

/** Remote operands only resolve inside the containment envelope, after the
 *  repository root has been verified: `git remote`/`get-url` are plain config
 *  reads, but running them anywhere would inspect an arbitrary repository.
 *  The listing is gated on actual demand so plain add/commit reviews spawn
 *  no extra git processes. */
async function remoteRecord(
  gitDirectory: string,
  planned: PlannedGitActions,
  neutralization: string[],
): Promise<Record<string, unknown>> {
  if (
    planned.remoteCandidates.length === 0 &&
    planned.needsDefaultRemote.length === 0
  )
    return {};
  const remotes = await runGit(gitDirectory, ["remote"], neutralization);
  const configuredNames = remotes.ok
    ? remotes.stdout
        .split(/\s+/)
        .filter((name) => name.length > 0)
        .slice(0, 50)
    : [];
  const resolution = remotes.ok
    ? await resolveRemoteTargets(
        gitDirectory,
        planned,
        configuredNames,
        neutralization,
      )
    : {
        targets: [],
        omitted: 0,
        defaults: [
          {
            source: "unresolved",
            note: `configured remote listing failed: ${remotes.reason.slice(0, 200)}`,
          } satisfies DefaultRemoteRecord,
        ],
      };
  return {
    remoteTargets: resolution.targets,
    remoteTargetsOmitted: resolution.omitted,
    defaultRemotes: resolution.defaults,
    configuredRemotes: configuredNames,
  };
}

function affectedTargetDiff(
  gitDirectory: string,
  planned: PlannedGitActions,
  neutralization: string[],
): Promise<GitRun> | undefined {
  const affectedTargets = [
    ...new Set([...planned.discardTargets, ...planned.removeTargets]),
  ].filter((value) => !UNRESOLVED_EXPANSION.test(value));
  return affectedTargets.length === 0
    ? undefined
    : runGit(
        gitDirectory,
        ["diff", "--numstat", "--no-ext-diff", "--", ...affectedTargets],
        neutralization,
      );
}

function numstatRecord(targetDiff: GitRun | undefined): Record<string, string> {
  if (targetDiff === undefined) return {};
  return targetDiff.ok
    ? {
        affectedTargetNumstat:
          targetDiff.stdout.slice(0, 8_000) || "<no unstaged diff>",
      }
    : { affectedTargetNumstat: `<unavailable: ${targetDiff.reason}>` };
}
