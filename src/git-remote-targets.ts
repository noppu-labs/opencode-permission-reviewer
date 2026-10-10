// Git remote resolution: classifies remote operands and resolves them and default remotes to redacted URLs.

import {
  type RemoteTargetRecord,
  remoteTarget,
} from "./git-candidate-target.ts";
import type { PlannedGitActions } from "./git-command-plan.ts";
import {
  type ConfiguredRemoteUrls,
  MAX_RESOLVED_REMOTES,
  resolveConfiguredRemote,
} from "./git-configured-remote.ts";
import {
  type DefaultRemoteRecord,
  defaultRemoteRecords,
} from "./git-default-remote.ts";
import { remoteOperandKind } from "./git-remote-identity.ts";
import { literalUrlRewrites } from "./git-url-rewrites.ts";

/** Resolve the collected remote operands against the repository's configured
 *  remotes, all through the neutralized, contained git runner. Every
 *  resolution failure stays a visible fact, never an invention. */
export async function resolveRemoteTargets(
  directory: string,
  planned: PlannedGitActions,
  configuredNames: string[],
  neutralization: string[],
): Promise<{
  targets: RemoteTargetRecord[];
  omitted: number;
  defaults: DefaultRemoteRecord[];
}> {
  const targets: RemoteTargetRecord[] = [];
  const seen = new Set<string>();
  // Resolution is memoized per remote: repeated operands and default-remote
  // fallbacks reuse one lookup instead of re-running git.
  const resolvedRemotes = new Map<string, ConfiguredRemoteUrls>();
  const rewrites = planned.remoteCandidates.some(
    (input) => remoteOperandKind(input) === "literal",
  )
    ? await literalUrlRewrites(directory, neutralization)
    : undefined;
  const resolveRemote = async (name: string): Promise<ConfiguredRemoteUrls> => {
    let resolved = resolvedRemotes.get(name);
    if (resolved === undefined) {
      resolved = await resolveConfiguredRemote(directory, name, neutralization);
      resolvedRemotes.set(name, resolved);
    }
    return resolved;
  };
  for (const input of planned.remoteCandidates) {
    if (targets.length >= MAX_RESOLVED_REMOTES) break;
    if (seen.has(input)) continue;
    seen.add(input);
    targets.push(
      // biome-ignore lint/performance/noAwaitInLoops: the outer candidate loop stays sequential: candidates resolve through the shared resolvedRemotes memo, which is filled only after each git lookup returns, and the loop stops once MAX_RESOLVED_REMOTES targets are recorded; overlapping candidates would spawn duplicate git lookups and overrun the cap
      await remoteTarget(input, rewrites, configuredNames, resolveRemote),
    );
  }

  const defaults = await defaultRemoteRecords(
    directory,
    planned.needsDefaultRemote,
    configuredNames,
    neutralization,
    resolveRemote,
  );

  return {
    targets,
    // Unique candidates beyond the resolution cap, including the one that
    // tripped it.
    omitted: Math.max(
      0,
      new Set(planned.remoteCandidates).size - targets.length,
    ),
    defaults,
  };
}
