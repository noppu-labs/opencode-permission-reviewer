// Git default remotes: which remote an operand-less network subcommand contacts, following git's own precedence.

import type { ResolveRemote } from "./git-configured-remote.ts";
import { sanitizeRemoteUrl } from "./git-remote-identity.ts";
import { runGit } from "./git-run.ts";

export interface DefaultRemoteRecord {
  source:
    | "branch pushRemote"
    | "remote.pushDefault"
    | "branch remote"
    | "origin fallback"
    | "all configured remotes"
    | "unresolved";
  name?: string | undefined;
  pushUrls?: string[] | undefined;
  fetchUrl?: string | undefined;
  note?: string | undefined;
}

export async function defaultRemoteRecords(
  directory: string,
  annotations: string[],
  configuredNames: string[],
  neutralization: string[],
  resolveRemote: ResolveRemote,
): Promise<DefaultRemoteRecord[]> {
  const defaults: DefaultRemoteRecord[] = [];
  for (const annotation of annotations) {
    if (annotation.includes("--all")) {
      defaults.push({
        source: "all configured remotes",
        note: `${annotation} contacts every configured remote: ${configuredNames.slice(0, 10).join(", ") || "(none configured)"}`,
      });
      continue;
    }
    defaults.push(
      // biome-ignore lint/performance/noAwaitInLoops: each default-remote annotation spawns git config lookups through the shared resolvedRemotes memo, which is filled only after git returns; one annotation at a time reuses earlier lookups instead of spawning duplicates
      await resolveDefaultRemote(
        directory,
        annotation,
        configuredNames,
        neutralization,
        resolveRemote,
      ),
    );
  }
  return defaults;
}

/** Resolve which remote a no-operand network subcommand contacts, following
 *  git's own precedence: push consults branch.<name>.pushRemote, then
 *  remote.pushDefault, then branch.<name>.remote; fetch/pull consult
 *  branch.<name>.remote; both fall back to origin when configured. The
 *  configured value may itself be a URL rather than a remote name, so it is
 *  bounded and redacted like any operand. */
async function resolveDefaultRemote(
  directory: string,
  annotation: string,
  configuredNames: string[],
  neutralization: string[],
  resolveRemote: ResolveRemote,
): Promise<DefaultRemoteRecord> {
  const branch = await runGit(
    directory,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    neutralization,
  );
  if (!branch.ok) {
    return {
      source: "unresolved",
      note: "current branch could not be resolved",
    };
  }
  const branchName = branch.stdout.trim();
  const configChain =
    annotation === "push"
      ? [
          {
            key: `branch.${branchName}.pushRemote`,
            source: "branch pushRemote" as const,
          },
          { key: "remote.pushDefault", source: "remote.pushDefault" as const },
          {
            key: `branch.${branchName}.remote`,
            source: "branch remote" as const,
          },
        ]
      : [
          {
            key: `branch.${branchName}.remote`,
            source: "branch remote" as const,
          },
        ];
  for (const step of configChain) {
    // biome-ignore lint/performance/noAwaitInLoops: git's own precedence order (pushRemote, then remote.pushDefault, then branch remote); returns at the first key that is set, so later keys must not be spawned before an earlier one is ruled out
    const value = await runGit(
      directory,
      ["config", "--get", step.key],
      neutralization,
    );
    if (!value.ok || !value.stdout.trim()) continue;
    const rawName = value.stdout.trim();
    const name = sanitizeRemoteUrl(rawName).slice(0, 200);
    if (!configuredNames.includes(rawName)) {
      // branch.*.remote may legitimately hold a URL or path instead of a
      // configured remote name: report it as the destination verbatim
      // (bounded) instead of resolving it as a name.
      return {
        source: step.source,
        name,
        note: "configured value is not a named remote",
      };
    }
    const urls = await resolveRemote(rawName);
    return { source: step.source, name, ...urls };
  }
  if (configuredNames.includes("origin")) {
    const urls = await resolveRemote("origin");
    return { source: "origin fallback", name: "origin", ...urls };
  }
  return {
    source: "unresolved",
    note: `no branch.${branchName}.remote, no remote.pushDefault, and no origin remote is configured`,
  };
}
