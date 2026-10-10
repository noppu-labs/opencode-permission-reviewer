// Git remote operands: the remotes, URLs and default-remote annotations a network subcommand or `git remote` verb names.

import { elementAt } from "./element-at.ts";
import { NETWORK_VALUE_OPTIONS } from "./git-network-options.ts";

/** Verbs of `git remote` that operate on a named remote as their next
 *  positional. `update` takes an optional group, not a remote name. */
const REMOTE_VERBS_WITH_NAME = new Set([
  "prune",
  "show",
  "get-url",
  "set-url",
  "set-head",
  "rename",
  "remove",
  "rm",
]);

/** First positional operand of a network subcommand, skipping options and
 *  their separate values. Returns the operand plus any `--repo`-style
 *  override value, which is itself a push destination. */
function networkOperand(
  tokens: string[],
  index: number,
  subcommand: string,
): { operand?: string | undefined; repoOverride?: string | undefined } {
  const valueOpts = NETWORK_VALUE_OPTIONS[subcommand] ?? new Set<string>();
  let afterSeparator = false;
  let operand: string | undefined;
  let repoOverride: string | undefined;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = elementAt(tokens, cursor, "tokens");
    if (token === "--") {
      afterSeparator = true;
    } else if (!afterSeparator && token.startsWith("-") && token.length > 1) {
      const option = networkOption(tokens, cursor, subcommand, valueOpts);
      cursor = option.last;
      repoOverride = option.repoOverride ?? repoOverride;
    } else {
      operand ??= token;
    }
  }
  return repoOverride === undefined ? { operand } : { repoOverride };
}

/** One option of a network subcommand at `cursor`: the index of its last
 *  token (its separate value, if it takes one) and the `--repo` override it
 *  sets, if any. */
function networkOption(
  tokens: string[],
  cursor: number,
  subcommand: string,
  valueOpts: ReadonlySet<string>,
): { last: number; repoOverride?: string } {
  const token = elementAt(tokens, cursor, "tokens");
  if (token === "--repo" && cursor + 1 < tokens.length)
    return {
      last: cursor + 1,
      repoOverride: elementAt(tokens, cursor + 1, "tokens"),
    };
  if (subcommand === "push" && token.startsWith("--repo="))
    return { last: cursor, repoOverride: token.slice("--repo=".length) };
  return { last: valueOpts.has(token) ? cursor + 1 : cursor };
}

export interface RemoteTargets {
  candidates: string[];
  defaultRemote?: string;
}

/** Remote operands a network subcommand names, or the default-remote
 *  annotation it needs when it names none. */
export function networkTargets(
  tokens: string[],
  index: number,
  subcommand: string,
): RemoteTargets {
  const { operand, repoOverride } = networkOperand(tokens, index, subcommand);
  const candidates: string[] = [];
  if (repoOverride !== undefined) candidates.push(repoOverride);
  if (operand !== undefined) candidates.push(operand);
  if (candidates.length > 0) return { candidates };
  // --all fetches every configured remote, not just the default.
  const all =
    (subcommand === "fetch" || subcommand === "pull") &&
    tokens.includes("--all");
  return {
    candidates,
    defaultRemote: all ? `${subcommand} --all` : subcommand,
  };
}

/** Remote names and URLs a `git remote` verb operates on, or the
 *  default-remote annotation `remote update` needs, from the positionals
 *  after `remote`. */
export function remoteVerbTargets(positionals: string[]): RemoteTargets {
  const [verb, name, url] = positionals;
  // `remote update` fetches every configured remote (or the group's
  // members) when no group operand is given.
  if (verb === "update")
    return name === undefined
      ? { candidates: [], defaultRemote: "remote update --all" }
      : { candidates: [] };
  if (verb === undefined || !REMOTE_VERBS_WITH_NAME.has(verb))
    return { candidates: [] };
  const candidates = name === undefined ? [] : [name];
  // set-url rewrites where the remote points: the new URL is a
  // destination fact, not just a name.
  if (verb === "set-url" && url !== undefined) candidates.push(url);
  return { candidates };
}

const MAX_REMOTE_CANDIDATES = 8;
const MAX_DEFAULT_REMOTES = 4;

/** Adds a subcommand's remote targets to the plan, within its bounds. */
export function recordRemoteTargets(
  result: { remoteCandidates: string[]; needsDefaultRemote: string[] },
  targets: RemoteTargets,
): void {
  for (const candidate of targets.candidates) {
    if (result.remoteCandidates.length < MAX_REMOTE_CANDIDATES)
      result.remoteCandidates.push(candidate);
  }
  if (
    targets.defaultRemote !== undefined &&
    result.needsDefaultRemote.length < MAX_DEFAULT_REMOTES
  )
    result.needsDefaultRemote.push(targets.defaultRemote);
}
