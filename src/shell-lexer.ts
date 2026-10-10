/*
 * Minimal shell-aware tokenizer used by the deterministic emergency brake.
 *
 * This is NOT a full shell interpreter. It performs just enough static
 * analysis to evaluate the *real* executable of a command:
 *   - grouping of single/double quotes (so separators inside quotes do not
 *     split a token, and `printf "a; sudo rm -rf /"` stays one argument),
 *   - splitting on logical command separators (`;`, `|`, `&`, newlines),
 *   - stripping `#` comments when they begin a token.
 *
 * It deliberately does NOT expand variables, globs, command substitutions,
 * heredocs, or arithmetic. Those remain the model reviewer's job; the brake
 * is only a last line of defense for *unmistakable* literal destruction.
 */

import { invariant } from "./invariant.ts";

export interface ShellToken {
  /** Original text including any surrounding quotes. */
  raw: string;
  /** Unquoted/normalized value used for comparisons. */
  value: string;
  /** Value split into spans by quoting: every character of `value` appears
   *  in exactly one span, marked `quoted` when it came from inside quotes
   *  or from a backslash escape. An operator character (`>`, `*`, …) only
   *  acts as an operator while it sits in an UNQUOTED span: a glued, partly
   *  quoted `>"/dev/sda"` still redirects, while `'>/dev/sda'` is data. */
  spans?: Array<{ text: string; quoted: boolean }>;
}

export interface ShellSegment {
  tokens: ShellToken[];
  /** Separator that terminated this segment (`;`, `|`, `||`, `&`, `&&`, `(`,
   *  `)`). Newlines and carriage returns are reported as `;`. Absent for the
   *  final segment when the command does not end with a separator. A segment
   *  with no tokens and `endedBy` `(` or `)` is a paren marker: it exists so
   *  grouping events are never lost, and carries no command of its own. */
  endedBy?: string;
  /** The last separator seen before this segment's first token, counting
   *  separators whose (empty) segment was dropped: in `( a ) | b`, segment
   *  `b` ended up after a dropped empty segment, so its separator lineage is
   *  `)` and then `|`, and `precededBy` reports `|`. Absent for the first
   *  segment. */
  precededBy?: string;
}

export interface ShellRedirection {
  operator: string;
  target: string;
  quoted: boolean;
}

/** Segments flattened to plain token values plus the separators around each
 *  segment. This is the shared surface evidence consumers (SSH, Git, local
 *  scripts) build on, so the brake's lexer stays the one tokenizer. */
export interface CommandSegment {
  tokens: string[];
  preceding?: string;
  endedBy?: string;
}

export function commandSegments(command: string): CommandSegment[] {
  return lexSegments(command).map((segment) => {
    const normalized = normalizeShellRedirections(segment.tokens);
    return {
      tokens: normalized.tokens.map((token) => token.value),
      ...(segment.precededBy === undefined
        ? {}
        : { preceding: segment.precededBy }),
      ...(segment.endedBy === undefined ? {} : { endedBy: segment.endedBy }),
    };
  });
}

const SEPARATORS = new Set([";", "|", "&", "\n", "\r", "(", ")"]);
const WHITESPACE = new Set([" ", "\t"]);

/** Ceiling on collected effective commands. Command strings can expand
 *  combinatorially (a level duplicating its script doubles the output), so
 *  past this bound collection stops instead of exhausting time or memory on
 *  adversarial input. */
export const MAX_EFFECTIVE_COMMANDS = 4096;

/** Hard cap on the raw text a single lexing pass accepts, and on the tokens
 *  it may materialize, both checked BEFORE building large structures. */
export const MAX_ANALYSIS_INPUT_CHARS = 131_072;
const MAX_LEX_TOKENS = 16_384;
const MAX_REANALYSIS_CHARS = 262_144;

/** Per-request analysis budget: one instance covers a whole permission
 *  request (every segment, every nested command string), not a single
 *  segment. Without shared counters, an input made of thousands of small
 *  segments stayed under every per-call ceiling while the TOTAL work grew
 *  without bound. `remainingReanalysisChars` bounds the text re-lexed while
 *  destructuring command strings (`sh -c '…'`, `env -S …`). */
export interface AnalysisBudget {
  remainingCommands: number;
  remainingReanalysisChars: number;
}

export function newAnalysisBudget(): AnalysisBudget {
  return {
    remainingCommands: MAX_EFFECTIVE_COMMANDS,
    remainingReanalysisChars: MAX_REANALYSIS_CHARS,
  };
}

function basename(exe: string): string {
  const slash = exe.lastIndexOf("/");
  return slash >= 0 ? exe.slice(slash + 1) : exe;
}

/** Whether the character at `index` of `token.value` lies in a quoted or
 *  escaped span, where it cannot act as a shell operator. Tokens without
 *  span information fall back to whole-token conservatism. */
export function tokenCharIsQuoted(token: ShellToken, index: number): boolean {
  const spans = token.spans;
  if (spans === undefined) return token.raw !== token.value;
  let offset = 0;
  for (const span of spans) {
    if (index < offset + span.text.length) return span.quoted;
    offset += span.text.length;
  }
  return false;
}

/**
 * Tokenize `command` into logical segments (one per sub-command separated by
 * `;`, `|`, `&`, or newline) with quote-aware, comment-aware grouping.
 * `state.tokensRemaining` (when given) is decremented per token and stops
 * the scan at zero: callers that must not miss tail content use
 * `lexSegmentsBounded` and treat the stop as a truncation fact.
 */
export function lexSegments(
  command: string,
  state?: { tokensRemaining: number },
): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let tokens: ShellToken[] = [];
  let value = "";
  let raw = "";
  let hasToken = false;
  let spans: Array<{ text: string; quoted: boolean }> = [];
  let inSingle = false;
  let inDouble = false;
  let lastSeparator: string | undefined;
  let outOfTokens = false;

  const appendValue = (text: string, quoted: boolean): void => {
    if (text.length === 0) return;
    const last = spans.at(-1);
    if (last !== undefined && last.quoted === quoted) last.text += text;
    else spans.push({ text, quoted });
    value += text;
  };

  const flushToken = (): void => {
    if (hasToken) {
      tokens.push({ raw, value, spans });
      value = "";
      raw = "";
      spans = [];
      hasToken = false;
      if (state !== undefined) {
        state.tokensRemaining -= 1;
        if (state.tokensRemaining <= 0) outOfTokens = true;
      }
    }
  };
  const flushSegment = (endedBy?: string): void => {
    flushToken();
    // Paren separators survive as empty marker segments even without tokens:
    // the directory tracker needs every open/close event, and dropping the
    // empties left nested closes unbalanced (`( cd x; (a) ) b` restored the
    // wrong state after the group). Other empty flushes stay dropped.
    if (tokens.length > 0 || endedBy === "(" || endedBy === ")") {
      segments.push({
        tokens,
        ...(endedBy === undefined ? {} : { endedBy }),
        ...(lastSeparator === undefined ? {} : { precededBy: lastSeparator }),
      });
      tokens = [];
    }
  };

  let i = 0;
  while (i < command.length) {
    if (outOfTokens) break;
    const c = command.charAt(i);
    if (inSingle) {
      raw += c;
      if (c === "'") inSingle = false;
      else appendValue(c, true);
      i += 1;
      continue;
    }
    if (inDouble) {
      raw += c;
      if (c === '"') {
        inDouble = false;
      } else if (c === "\\" && i + 1 < command.length) {
        const next = command.charAt(i + 1);
        raw += next;
        // Inside double quotes bash only unescapes $ ` " \ and the newline
        // (a line continuation). A backslash before any other character,
        // including `n`, stays a literal backslash in the value.
        if (next === "\n" || next === "\r") {
          i += 2;
          continue;
        }
        if ('$`"\\'.includes(next)) {
          appendValue(next, true);
          i += 2;
          continue;
        }
        appendValue("\\", true);
        i += 1;
        continue;
      } else {
        appendValue(c, true);
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      raw += c;
      hasToken = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      raw += c;
      hasToken = true;
      i += 1;
      continue;
    }
    // Redirection operators may contain characters that are command
    // separators elsewhere. Keep `&>`, `2>&1`, and `>|file` inside the token
    // so the redirection normalizer below can interpret them as one shell
    // construct instead of inventing extra commands.
    if (
      (c === "&" &&
        (command[i + 1] === ">" ||
          (value.endsWith(">") &&
            !tokenCharIsQuoted({ raw, value, spans }, value.length - 1)))) ||
      (c === "|" &&
        value.endsWith(">") &&
        !tokenCharIsQuoted({ raw, value, spans }, value.length - 1))
    ) {
      appendValue(c, false);
      raw += c;
      hasToken = true;
      i += 1;
      continue;
    }
    if (SEPARATORS.has(c)) {
      // Capture the operator identity (including doubled `||`/`&&`) so
      // evidence consumers can reason about how segments relate.
      let endedBy = c === "\n" || c === "\r" ? ";" : c;
      if ((c === "|" || c === "&") && command[i + 1] === c) {
        endedBy = `${c}${c}`;
        i += 1;
      }
      flushSegment(endedBy);
      lastSeparator = endedBy;
      i += 1;
      continue;
    }
    if (WHITESPACE.has(c)) {
      flushToken();
      i += 1;
      continue;
    }
    if (c === "#" && !hasToken) {
      // Line comment: consume until newline (newline itself closes the segment).
      while (i < command.length && command[i] !== "\n") i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      const next = command.charAt(i + 1);
      raw += `\\${next}`;
      // Backslash-newline is a line continuation outside quotes: both
      // characters vanish, so `r\<newline>m` lexes as the token `rm`.
      if (next !== "\n" && next !== "\r") {
        appendValue(next, true);
        hasToken = true;
      }
      i += 2;
      continue;
    }
    appendValue(c, false);
    raw += c;
    hasToken = true;
    i += 1;
  }
  if (!outOfTokens) flushSegment();
  return segments;
}

/** Bounded lexing pass: refuses oversized input up front and stops at the
 *  token cap, reporting `truncated` so no caller mistakes a prefix for the
 *  whole command. */
export interface LexAnalysis {
  segments: ShellSegment[];
  truncated: boolean;
}

export function lexSegmentsBounded(command: string): LexAnalysis {
  if (command.length > MAX_ANALYSIS_INPUT_CHARS)
    return { segments: [], truncated: true };
  const state = { tokensRemaining: MAX_LEX_TOKENS };
  const segments = lexSegments(command, state);
  return { segments, truncated: state.tokensRemaining <= 0 };
}

/** Return a token slice while preserving quote provenance for each character. */
function sliceToken(
  token: ShellToken,
  start: number,
  end = token.value.length,
): ShellToken {
  const value = token.value.slice(start, end);
  const spans: Array<{ text: string; quoted: boolean }> = [];
  let offset = 0;
  for (const span of token.spans ?? [
    { text: token.value, quoted: token.raw !== token.value },
  ]) {
    const spanStart = offset;
    const spanEnd = offset + span.text.length;
    const from = Math.max(start, spanStart);
    const to = Math.min(end, spanEnd);
    if (from < to) {
      const text = span.text.slice(from - spanStart, to - spanStart);
      const previous = spans.at(-1);
      if (previous?.quoted === span.quoted) previous.text += text;
      else spans.push({ text, quoted: span.quoted });
    }
    offset = spanEnd;
  }
  return { raw: value, value, spans };
}

function redirectionOperatorAt(
  token: ShellToken,
  index: number,
): string | undefined {
  const value = token.value;
  const live = (offset: number): string | undefined =>
    offset < value.length && !tokenCharIsQuoted(token, offset)
      ? value[offset]
      : undefined;
  const first = live(index);
  const tail = `${first ?? ""}${live(index + 1) ?? ""}${live(index + 2) ?? ""}`;
  if (tail.startsWith("&>>")) return "&>>";
  if (tail.startsWith("<<<")) return "<<<";
  if (tail.startsWith("<<-")) return "<<-";
  for (const operator of ["&>", ">>", ">|", ">&", "<<", "<&", "<>"] as const) {
    if (tail.startsWith(operator)) return operator;
  }
  if (first === ">" || first === "<") return first;
  return undefined;
}

function nextRedirection(
  token: ShellToken,
  start: number,
): { index: number; operator: string } | undefined {
  for (let index = start; index < token.value.length; index += 1) {
    const operator = redirectionOperatorAt(token, index);
    if (operator !== undefined) return { index, operator };
  }
  return undefined;
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
  const words: ShellToken[] = [];
  const redirections: ShellRedirection[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    invariant(token, "tokens[tokenIndex] is in bounds");
    // The heredoc extractor inserts this inert marker after removing the body.
    // It is evidence metadata, not another input redirection.
    if (/^<HEREDOC:sha256:[a-f0-9]+>$/.test(token.value)) {
      words.push(token);
      continue;
    }
    let cursor = 0;
    let found = nextRedirection(token, cursor);
    if (found === undefined) {
      words.push(token);
      continue;
    }
    while (found !== undefined) {
      let wordEnd = found.index;
      let operator = found.operator;
      const prefix = token.value.slice(cursor, found.index);
      // An all-digit prefix immediately before the operator is an IO number,
      // not a command word (`2>`, `10>>`).
      if (cursor === 0 && /^[0-9]+$/.test(prefix)) {
        operator = `${prefix}${operator}`;
        wordEnd = cursor;
      }
      if (wordEnd > cursor) words.push(sliceToken(token, cursor, wordEnd));

      const targetStart = found.index + found.operator.length;
      const following = nextRedirection(token, targetStart);
      let targetToken: ShellToken | undefined;
      if (targetStart < (following?.index ?? token.value.length)) {
        targetToken = sliceToken(token, targetStart, following?.index);
      } else if (following === undefined) {
        const candidate = tokens[tokenIndex + 1];
        if (
          candidate !== undefined &&
          nextRedirection(candidate, 0)?.index !== 0
        ) {
          tokenIndex += 1;
          targetToken = candidate;
        }
      }
      if (targetToken !== undefined) {
        redirections.push({
          operator,
          target: targetToken.value,
          quoted:
            targetToken.value.length > 0 &&
            Array.from(
              { length: targetToken.value.length },
              (_, index) => index,
            ).some((index) => tokenCharIsQuoted(targetToken, index)),
        });
      }
      cursor = following?.index ?? token.value.length;
      found = following;
    }
  }
  return { tokens: words, redirections };
}

export { basename as shellBasename };
