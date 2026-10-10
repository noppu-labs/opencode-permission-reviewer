// Splits shell redirections (`2>log`, `cmd>out`, `<<<word`) away from command words.

import { elementAt } from "./element-at.ts";
import { nextRedirection } from "./shell-redirection-operators.ts";
import { hasQuotedChar, type ShellToken, sliceToken } from "./shell-token.ts";

export interface ShellRedirection {
  operator: string;
  target: string;
  quoted: boolean;
}

/** The heredoc extractor inserts this inert marker after removing the body.
 *  It is evidence metadata, not another input redirection. */
const HEREDOC_MARKER = /^<HEREDOC:sha256:[a-f0-9]+>$/;

interface RedirectionSplit {
  words: ShellToken[];
  redirections: ShellRedirection[];
}

function pushRedirection(
  split: RedirectionSplit,
  operator: string,
  target: ShellToken,
): void {
  split.redirections.push({
    operator,
    target: target.value,
    quoted: hasQuotedChar(target),
  });
}

/** Push the word text between `cursor` and the operator at `found`, and
 *  return the operator. An all-digit prefix immediately before the operator
 *  is an IO number, not a command word (`2>`, `10>>`), and joins the
 *  operator instead. */
function splitLeadingWord(
  token: ShellToken,
  cursor: number,
  found: { index: number; operator: string },
  words: ShellToken[],
): string {
  const prefix = token.value.slice(cursor, found.index);
  if (cursor === 0 && /^[0-9]+$/.test(prefix))
    return `${prefix}${found.operator}`;
  if (found.index > cursor) words.push(sliceToken(token, cursor, found.index));
  return found.operator;
}

/** Split one word into its words and redirections, starting at the first
 *  operator `found`. Returns the last operator when the word ends right after
 *  it, so the caller can take the next word as its target. */
function splitWordRedirections(
  token: ShellToken,
  first: { index: number; operator: string },
  split: RedirectionSplit,
): string | undefined {
  let found: { index: number; operator: string } | undefined = first;
  let cursor = 0;
  let dangling: string | undefined;
  while (found !== undefined) {
    const operator = splitLeadingWord(token, cursor, found, split.words);
    const targetStart = found.index + found.operator.length;
    const following = nextRedirection(token, targetStart);
    const end = following?.index ?? token.value.length;
    if (targetStart < end)
      pushRedirection(split, operator, sliceToken(token, targetStart, end));
    else if (following === undefined) dangling = operator;
    cursor = end;
    found = following;
  }
  return dangling;
}

/** Push a word with no redirection as is; otherwise split it and return the
 *  operator left without a target at its end, if any. */
function splitWord(
  token: ShellToken,
  split: RedirectionSplit,
): string | undefined {
  const found = HEREDOC_MARKER.test(token.value)
    ? undefined
    : nextRedirection(token, 0);
  if (found === undefined) {
    split.words.push(token);
    return undefined;
  }
  return splitWordRedirections(token, found, split);
}

/**
 * Split shell redirections away from command words. Shell accepts them before,
 * after, or glued to the executable and its arguments (`2>log cmd`,
 * `cmd>log`, `echo x>out`). Leaving those forms inside word tokens can hide the
 * real executable or make a redirection target look like an ordinary operand.
 */
export function normalizeShellRedirections(tokens: ShellToken[]): {
  tokens: ShellToken[];
  redirections: ShellRedirection[];
} {
  const split: RedirectionSplit = { words: [], redirections: [] };
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const dangling = splitWord(elementAt(tokens, tokenIndex, "tokens"), split);
    if (dangling === undefined) continue;
    const candidate = tokens[tokenIndex + 1];
    if (candidate === undefined || nextRedirection(candidate, 0)?.index === 0)
      continue;
    pushRedirection(split, dangling, candidate);
    tokenIndex += 1;
  }
  return { tokens: split.words, redirections: split.redirections };
}
