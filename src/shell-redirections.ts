// Splits shell redirections (`2>log`, `cmd>out`, `<<<word`) away from command words.

import { elementAt } from "./element-at.ts";
import { redirectionsIn } from "./shell-redirection-operators.ts";
import {
  hasQuotedChar,
  indexSpans,
  type ShellToken,
  sliceIndexed,
} from "./shell-token.ts";

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
  slice: (start: number, end: number) => ShellToken,
): string {
  const prefix = token.value.slice(cursor, found.index);
  if (cursor === 0 && /^[0-9]+$/.test(prefix))
    return `${prefix}${found.operator}`;
  if (found.index > cursor) words.push(slice(cursor, found.index));
  return found.operator;
}

/** Split one word into its words and redirections, starting at the first
 *  operator `found`. Returns the last operator when the word ends right after
 *  it, so the caller can take the next word as its target. */
function splitWordRedirections(
  token: ShellToken,
  operators: { index: number; operator: string }[],
  split: RedirectionSplit,
): string | undefined {
  const spans = indexSpans(token);
  const slice = (start: number, end: number): ShellToken =>
    sliceIndexed(token, spans, start, end);
  let cursor = 0;
  let dangling: string | undefined;
  operators.forEach((found, position) => {
    const following = operators[position + 1];
    const operator = splitLeadingWord(token, cursor, found, split.words, slice);
    const targetStart = found.index + found.operator.length;
    const end = following?.index ?? token.value.length;
    if (targetStart < end)
      pushRedirection(split, operator, slice(targetStart, end));
    else if (following === undefined) dangling = operator;
    cursor = end;
  });
  return dangling;
}

/** Push a word with no redirection as is; otherwise split it and return the
 *  operator left without a target at its end, if any. */
function splitWord(
  token: ShellToken,
  split: RedirectionSplit,
): string | undefined {
  // The marker is evidence metadata: it is neither a command word nor a
  // redirection, so it leaves the words and the redirection list alone.
  if (HEREDOC_MARKER.test(token.value)) return undefined;
  const operators = redirectionsIn(token);
  if (operators.length === 0) {
    split.words.push(token);
    return undefined;
  }
  return splitWordRedirections(token, operators, split);
}

/** Whether the word's text ends in an empty quote (`<<<''`, `>$""`): the
 *  lexer leaves an empty quoted span there under bash's reading. */
function endsInEmptyQuote(token: ShellToken): boolean {
  const last = token.spans?.at(-1);
  return last?.quoted === true && last.text === "";
}

const EMPTY_TARGET: ShellToken = { raw: "", value: "", spans: [] };

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
    const token = elementAt(tokens, tokenIndex, "tokens");
    const dangling = splitWord(token, split);
    if (dangling === undefined) continue;
    if (endsInEmptyQuote(token)) {
      pushRedirection(split, dangling, EMPTY_TARGET);
      continue;
    }
    const candidate = tokens[tokenIndex + 1];
    if (candidate === undefined || redirectionsIn(candidate)[0]?.index === 0)
      continue;
    pushRedirection(split, dangling, candidate);
    tokenIndex += 1;
  }
  return { tokens: split.words, redirections: split.redirections };
}
