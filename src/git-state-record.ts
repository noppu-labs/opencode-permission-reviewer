// Git state record: the available snapshot of a contained repository, built from its status and the plan's demands.

import { boundedList, type PlannedGitActions } from "./git-command-plan.ts";
import { UNRESOLVED_EXPANSION } from "./git-execution-directory.ts";
import type { Inspection } from "./git-inspection-gate.ts";
import { remoteRecord } from "./git-remote-evidence.ts";
import { rewriteEvidence } from "./git-rewrite-evidence.ts";
import { runGit } from "./git-run.ts";

function unresolved(values: string[]): string[] {
  return values.filter((value) => UNRESOLVED_EXPANSION.test(value));
}

type GitRun = Awaited<ReturnType<typeof runGit>>;

export async function stateRecord(
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
