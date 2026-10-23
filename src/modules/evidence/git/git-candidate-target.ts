// Git candidate targets: the record for one remote operand, as a configured remote, a literal destination or an unmatched name.

import {
  type ConfiguredRemoteUrls,
  MAX_RESOLVED_REMOTES,
  type ResolveRemote,
} from "./git-configured-remote.ts";
import {
  remoteOperandKind,
  repositoryIdentity,
  sanitizeRemoteUrl,
} from "./git-remote-identity.ts";
import { literalUrls, type UrlRewrite } from "./git-url-rewrites.ts";

export interface RemoteTargetRecord {
  input: string;
  kind: "configured-remote" | "literal" | "unmatched";
  url?: string | undefined;
  pushUrls?: string[] | undefined;
  fetchUrl?: string | undefined;
  note?: string | undefined;
  configuredMatches?: Array<{ name: string; push: boolean; fetch: boolean }>;
}

export async function remoteTarget(
  input: string,
  rewrites: UrlRewrite[] | undefined,
  configuredNames: string[],
  resolveRemote: ResolveRemote,
): Promise<RemoteTargetRecord> {
  // Every recorded operand is bounded and redacted: names get the length
  // cap, literals additionally lose credential userinfo.
  const bounded = sanitizeRemoteUrl(input).slice(0, 200);
  if (remoteOperandKind(input) === "literal")
    return literalTarget(
      input,
      bounded,
      rewrites,
      configuredNames,
      resolveRemote,
    );
  if (configuredNames.includes(input)) {
    const urls = await resolveRemote(input);
    return { input: bounded, kind: "configured-remote", ...urls };
  }
  return {
    input: bounded,
    kind: "unmatched",
    note: "matches no configured remote; git treats the operand as a direct repository URL or path (the command fails unless that target exists)",
  };
}

async function literalTarget(
  input: string,
  bounded: string,
  rewrites: UrlRewrite[] | undefined,
  configuredNames: string[],
  resolveRemote: ResolveRemote,
): Promise<RemoteTargetRecord> {
  const identity = repositoryIdentity(input);
  const literal = literalUrls(input, rewrites);
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
      : await Promise.all(
          configuredNames
            .slice(0, MAX_RESOLVED_REMOTES)
            .map(async (name) =>
              roleMatch(
                name,
                await resolveRemote(name),
                pushIdentity,
                fetchIdentity,
              ),
            ),
        );
  const matches = remoteRoles.filter((match) => match.push || match.fetch);
  return {
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
  };
}

function roleMatch(
  name: string,
  urls: ConfiguredRemoteUrls,
  pushIdentity: string | undefined,
  fetchIdentity: string | undefined,
): { name: string; push: boolean; fetch: boolean } {
  return {
    name,
    push:
      pushIdentity !== undefined &&
      (urls.pushUrls?.some((url) => repositoryIdentity(url) === pushIdentity) ??
        false),
    fetch:
      fetchIdentity !== undefined &&
      urls.fetchUrl !== undefined &&
      repositoryIdentity(urls.fetchUrl) === fetchIdentity,
  };
}
