// Git configured remotes: resolves a configured remote name to its redacted push and fetch URLs.

import { sanitizeRemoteUrl } from "./git-remote-identity.ts";
import { runGit } from "./git-run.ts";

export const MAX_RESOLVED_REMOTES = 5;
const MAX_PUSH_URLS = 5;

export interface ConfiguredRemoteUrls {
  pushUrls?: string[] | undefined;
  fetchUrl?: string | undefined;
  note?: string | undefined;
}

export type ResolveRemote = (name: string) => Promise<ConfiguredRemoteUrls>;

/** Push affects every configured pushurl (or every url when no pushurl
 *  exists), so resolution uses `get-url --push --all`: reporting only the
 *  first URL would hide a real destination. Fetch contacts only the first
 *  URL. Failures and empty output become notes, not silent absence. */
export async function resolveConfiguredRemote(
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
  const pushUrls = push.ok ? configuredPushUrls(push.stdout) : undefined;
  const fetchUrl =
    fetch.ok && fetch.stdout.trim()
      ? sanitizeRemoteUrl(fetch.stdout.trim())
      : undefined;
  const note = resolutionNote(pushUrls, fetchUrl);
  return {
    ...(pushUrls !== undefined ? { pushUrls } : {}),
    ...(fetchUrl !== undefined ? { fetchUrl } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

function configuredPushUrls(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_PUSH_URLS)
    .map(sanitizeRemoteUrl);
}

function resolutionNote(
  pushUrls: string[] | undefined,
  fetchUrl: string | undefined,
): string | undefined {
  if (pushUrls === undefined && fetchUrl === undefined)
    return "URL resolution failed for this remote";
  if (pushUrls === undefined) return "push URL resolution failed";
  if (fetchUrl === undefined) return "fetch URL resolution failed";
  return undefined;
}
