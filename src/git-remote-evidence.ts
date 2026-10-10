// Git remote evidence: lists the configured remotes and resolves the plan's remote operands and default remotes against them.

import type { PlannedGitActions } from "./git-command-plan.ts";
import {
  type DefaultRemoteRecord,
  resolveRemoteTargets,
} from "./git-remote-targets.ts";
import { runGit } from "./git-run.ts";

/** Remote operands only resolve inside the containment envelope, after the
 *  repository root has been verified: `git remote`/`get-url` are plain config
 *  reads, but running them anywhere would inspect an arbitrary repository.
 *  The listing is gated on actual demand so plain add/commit reviews spawn
 *  no extra git processes. */
export async function remoteRecord(
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
