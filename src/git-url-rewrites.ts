// Git URL rewrites: reads `url.<base>.insteadOf`/`pushInsteadOf` and expands a literal destination the way git would.

import type { ConfiguredRemoteUrls } from "./git-configured-remote.ts";
import { sanitizeRemoteUrl } from "./git-remote-identity.ts";
import { runGit } from "./git-run.ts";

export interface UrlRewrite {
  base: string;
  prefix: string;
  push: boolean;
}

export async function literalUrlRewrites(
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

/** Literal destinations have no configured pushurl. Apply the longest
 *  matching rewrite separately for fetch and push, without contacting it. */
export function literalUrls(
  input: string,
  rewrites: UrlRewrite[] | undefined,
): ConfiguredRemoteUrls {
  const pushUrl =
    rewrites === undefined
      ? undefined
      : expandLiteralUrl(input, rewrites, true);
  const fetchUrl =
    rewrites === undefined
      ? undefined
      : expandLiteralUrl(input, rewrites, false);
  return {
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
}
