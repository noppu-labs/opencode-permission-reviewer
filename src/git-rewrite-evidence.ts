// Git rewrite evidence: the commits a single-base rebase would rewrite, and which of them remote-tracking refs already hold.

import { boundedList, type PlannedGitActions } from "./git-command-plan.ts";
import { runGit } from "./git-run.ts";

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

export async function rewriteEvidence(
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
