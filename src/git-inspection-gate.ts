// Git inspection gate: contains the planned directory and repository root in the approved roots, neutralizes filters, and reads status.

import { realpath } from "node:fs/promises";
import { approvedEvidenceRoots, isWithinRoot } from "./evidence-path-policy.ts";
import type { PlannedGitActions } from "./git-command-plan.ts";
import { filterNeutralizationArgs } from "./git-filter-neutralization.ts";
import { runGit } from "./git-run.ts";
import { type ParsedStatus, parseStatus } from "./git-status-porcelain.ts";

export type Inspection =
  | {
      ok: true;
      gitDirectory: string;
      neutralization: string[];
      repositoryRoot: string;
      status: ParsedStatus;
    }
  | { ok: false; reason: string };

export async function verifiedInspection(
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
  // prefix would inspect an unrelated repository. It is checked against
  // `approvedEvidenceRoots()` on real paths, so symlinks cannot bridge out. An
  // unresolvable planned directory counts as outside.
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
  // realpath and the inspection subprocesses this gate admits cannot be
  // eliminated (git takes a path as cwd, not an open descriptor), but the
  // reviewed command has not run yet, so racing it requires a second
  // concurrent process.
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
