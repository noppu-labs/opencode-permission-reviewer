// Git remote resolution: classifies remote operands and resolves them and default remotes to redacted URLs.

import type { PlannedGitActions } from "./git-command-plan.ts";
import { runGit } from "./git-run.ts";

/** A remote operand can be a configured remote name, a literal URL, an
 *  SCP-like `user@host:path` target, or a local path. Only syntactic
 *  classification happens here; configured names are resolved to URLs later,
 *  inside the containment envelope. */
function remoteOperandKind(value: string): "literal" | "name" {
  if (value.includes("://")) return "literal";
  if (value.startsWith("/")) return "literal";
  // SCP-like user@host:path: a colon before any slash with a user@host pair
  // before it. A plain "branch:ref" refspec has no "@", so it stays a name
  // and is later reported as unmatched by the configured-remote list.
  const colon = value.indexOf(":");
  if (colon > 0 && /^[^/@\s]+@[^/@\s]+$/.test(value.slice(0, colon)))
    return "literal";
  return "name";
}

/** Remote URLs may embed credential userinfo, including a token in the username
 *  slot with no password. None of it belongs in reviewer evidence. SCP-style
 *  `git@host:path` values have no scheme and stay untouched. */
export function sanitizeRemoteUrl(url: string): string {
  // Redact before bounding: truncating first can remove the closing @ and
  // leave a credential prefix that no longer matches the userinfo pattern.
  return url
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)(?::[^\s/@]*)?@/gi,
      "$1<redacted>@",
    )
    .slice(0, 500);
}

interface RemoteTargetRecord {
  input: string;
  kind: "configured-remote" | "literal" | "unmatched";
  url?: string | undefined;
  pushUrls?: string[] | undefined;
  fetchUrl?: string | undefined;
  note?: string | undefined;
  configuredMatches?: Array<{ name: string; push: boolean; fetch: boolean }>;
}

/** Equate only documented GitHub transports; other destinations require exact URLs. */
function repositoryIdentity(value: string): string | undefined {
  if (value.length >= 200 || /[%\\]|(?:^|\/)\.{1,2}(?:\/|$)/.test(value))
    return;
  const scp = value.match(/^git@github\.com:([^\s?#]+)$/i);
  let path = scp?.[1];
  if (path === undefined) {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== "github.com") return `exact:${value}`;
      if (url.search || url.hash) return;
      if (
        !(
          url.protocol === "https:" &&
          (url.port === "" || url.port === "443")
        ) &&
        !(
          url.protocol === "ssh:" &&
          url.username === "git" &&
          (url.port === "" || url.port === "22")
        )
      )
        return;
      path = url.pathname.replace(/^\//, "");
    } catch {
      return `exact:${value}`;
    }
  }
  const normalized = path
    .replace(/\/$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  return /^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(normalized)
    ? `github:${normalized}`
    : undefined;
}

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

/** Resolve the collected remote operands against the repository's configured
 *  remotes, all through the neutralized, contained git runner. Every
 *  resolution failure stays a visible fact, never an invention. */
const MAX_RESOLVED_REMOTES = 5;
const MAX_PUSH_URLS = 5;

type ConfiguredRemoteUrls = Pick<
  RemoteTargetRecord,
  "pushUrls" | "fetchUrl" | "note"
>;

/** Push affects every configured pushurl (or every url when no pushurl
 *  exists), so resolution uses `get-url --push --all`: reporting only the
 *  first URL would hide a real destination. Fetch contacts only the first
 *  URL. Failures and empty output become notes, not silent absence. */
async function resolveConfiguredRemote(
  directory: string,
  name: string,
  neutralization: string[],
): Promise<ConfiguredRemoteUrls> {
  const push = await runGit(
    directory,
    ["remote", "get-url", "--push", "--all", name],
    neutralization,
  );
  const fetch = await runGit(
    directory,
    ["remote", "get-url", name],
    neutralization,
  );
  const pushUrls = push.ok
    ? push.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, MAX_PUSH_URLS)
        .map(sanitizeRemoteUrl)
    : undefined;
  const fetchUrl =
    fetch.ok && fetch.stdout.trim()
      ? sanitizeRemoteUrl(fetch.stdout.trim())
      : undefined;
  const note =
    pushUrls === undefined && fetchUrl === undefined
      ? "URL resolution failed for this remote"
      : pushUrls === undefined
        ? "push URL resolution failed"
        : fetchUrl === undefined
          ? "fetch URL resolution failed"
          : undefined;
  return {
    ...(pushUrls !== undefined ? { pushUrls } : {}),
    ...(fetchUrl !== undefined ? { fetchUrl } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

interface UrlRewrite {
  base: string;
  prefix: string;
  push: boolean;
}

async function literalUrlRewrites(
  directory: string,
  neutralization: string[],
): Promise<UrlRewrite[] | undefined> {
  const config = await runGit(
    directory,
    ["config", "--null", "--list"],
    neutralization,
  );
  if (!config.ok) return undefined;
  const rewrites: UrlRewrite[] = [];
  for (const entry of config.stdout.split("\0")) {
    const separator = entry.indexOf("\n");
    const key = entry.slice(0, separator);
    const match = key.match(/^url\.(.+)\.(pushinsteadof|insteadof)$/i);
    const base = match?.[1];
    const kind = match?.[2];
    if (base !== undefined && kind !== undefined)
      rewrites.push({
        base,
        prefix: entry.slice(separator + 1),
        push: kind.toLowerCase() === "pushinsteadof",
      });
  }
  return rewrites;
}

function expandLiteralUrl(
  input: string,
  rewrites: UrlRewrite[],
  push: boolean,
): string | undefined {
  const match = (pushOnly: boolean): UrlRewrite | "ambiguous" | undefined => {
    const matches = rewrites
      .filter(
        (rewrite) =>
          rewrite.push === pushOnly && input.startsWith(rewrite.prefix),
      )
      .sort((a, b) => b.prefix.length - a.prefix.length);
    if (
      matches.some(
        (candidate) =>
          candidate.prefix.length === matches[0]?.prefix.length &&
          candidate.base !== matches[0]?.base,
      )
    )
      return "ambiguous" as const;
    return matches[0];
  };
  const rewrite = (push ? match(true) : undefined) ?? match(false);
  if (rewrite === "ambiguous") return undefined;
  return rewrite ? rewrite.base + input.slice(rewrite.prefix.length) : input;
}

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
    // Every recorded operand is bounded and redacted: names get the length
    // cap, literals additionally lose credential userinfo.
    const bounded = sanitizeRemoteUrl(input).slice(0, 200);
    if (remoteOperandKind(input) === "literal") {
      const identity = repositoryIdentity(input);
      // Literal destinations have no configured pushurl. Apply the longest
      // matching rewrite separately for fetch and push, without contacting it.
      const pushUrl =
        rewrites === undefined
          ? undefined
          : expandLiteralUrl(input, rewrites, true);
      const fetchUrl =
        rewrites === undefined
          ? undefined
          : expandLiteralUrl(input, rewrites, false);
      const literal = {
        ...(pushUrl === undefined
          ? {}
          : { pushUrls: [sanitizeRemoteUrl(pushUrl)] }),
        ...(fetchUrl === undefined
          ? {}
          : { fetchUrl: sanitizeRemoteUrl(fetchUrl) }),
        ...(pushUrl === undefined || fetchUrl === undefined
          ? {
              note: "literal URL rewrite configuration is unavailable or ambiguous",
            }
          : {}),
      };
      const onlyPushUrl =
        literal.pushUrls?.length === 1 ? literal.pushUrls[0] : undefined;
      const pushIdentity =
        identity !== undefined && onlyPushUrl !== undefined
          ? repositoryIdentity(onlyPushUrl)
          : undefined;
      const fetchIdentity =
        identity !== undefined && literal.fetchUrl !== undefined
          ? repositoryIdentity(literal.fetchUrl)
          : undefined;
      const remoteRoles =
        pushIdentity === undefined && fetchIdentity === undefined
          ? []
          : // biome-ignore lint/performance/noAwaitInLoops: the outer candidate loop stays sequential: candidates resolve through the shared resolvedRemotes memo, which is filled only after each git lookup returns, and the loop stops once MAX_RESOLVED_REMOTES targets are recorded; overlapping candidates would spawn duplicate git lookups and overrun the cap
            await Promise.all(
              configuredNames
                .slice(0, MAX_RESOLVED_REMOTES)
                .map(async (name) => {
                  const urls = await resolveRemote(name);
                  return {
                    name,
                    push:
                      pushIdentity !== undefined &&
                      (urls.pushUrls?.some(
                        (url) => repositoryIdentity(url) === pushIdentity,
                      ) ??
                        false),
                    fetch:
                      fetchIdentity !== undefined &&
                      urls.fetchUrl !== undefined &&
                      repositoryIdentity(urls.fetchUrl) === fetchIdentity,
                  };
                }),
            );
      const matches = remoteRoles.filter((match) => match.push || match.fetch);
      targets.push({
        input: bounded,
        kind: "literal",
        url: bounded,
        ...literal,
        ...(matches.length === 0
          ? {}
          : {
              configuredMatches: matches,
              note: `${literal.note ? `${literal.note}; ` : ""}repository identity matches configured URLs only for the marked push/fetch roles; this does not establish authorization or destination trust`,
            }),
      });
      continue;
    }
    if (configuredNames.includes(input)) {
      const urls = await resolveRemote(input);
      targets.push({ input: bounded, kind: "configured-remote", ...urls });
      continue;
    }
    targets.push({
      input: bounded,
      kind: "unmatched",
      note: "matches no configured remote; git treats the operand as a direct repository URL or path (the command fails unless that target exists)",
    });
  }

  const defaults: DefaultRemoteRecord[] = [];
  for (const annotation of planned.needsDefaultRemote) {
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
  resolveRemote: (name: string) => Promise<ConfiguredRemoteUrls>,
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
