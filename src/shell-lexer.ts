/*
 * Minimal shell-aware tokenizer, NOT a full shell interpreter:
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

/** Mutable scan state shared by the per-character handlers below. `index`
 *  is the next character of `command` to read. */
interface LexState {
  command: string;
  budget: { tokensRemaining: number } | undefined;
  index: number;
  segments: ShellSegment[];
  tokens: ShellToken[];
  value: string;
  raw: string;
  hasToken: boolean;
  spans: Array<{ text: string; quoted: boolean }>;
  inSingle: boolean;
  inDouble: boolean;
  lastSeparator: string | undefined;
  outOfTokens: boolean;
}

function appendValue(lex: LexState, text: string, quoted: boolean): void {
  if (text.length === 0) return;
  const last = lex.spans.at(-1);
  if (last !== undefined && last.quoted === quoted) last.text += text;
  else lex.spans.push({ text, quoted });
  lex.value += text;
}

function flushToken(lex: LexState): void {
  if (!lex.hasToken) return;
  lex.tokens.push({ raw: lex.raw, value: lex.value, spans: lex.spans });
  lex.value = "";
  lex.raw = "";
  lex.spans = [];
  lex.hasToken = false;
  if (lex.budget !== undefined) {
    lex.budget.tokensRemaining -= 1;
    if (lex.budget.tokensRemaining <= 0) lex.outOfTokens = true;
  }
}

function flushSegment(lex: LexState, endedBy?: string): void {
  flushToken(lex);
  // Paren separators survive as empty marker segments even without tokens:
  // the directory tracker needs every open/close event, and dropping the
  // empties left nested closes unbalanced (`( cd x; (a) ) b` restored the
  // wrong state after the group). Other empty flushes stay dropped.
  if (lex.tokens.length > 0 || endedBy === "(" || endedBy === ")") {
    lex.segments.push({
      tokens: lex.tokens,
      ...(endedBy === undefined ? {} : { endedBy }),
      ...(lex.lastSeparator === undefined
        ? {}
        : { precededBy: lex.lastSeparator }),
    });
    lex.tokens = [];
  }
}

function lexSingleQuoted(lex: LexState, c: string): void {
  lex.raw += c;
  if (c === "'") lex.inSingle = false;
  else appendValue(lex, c, true);
  lex.index += 1;
}

function lexDoubleQuotedEscape(lex: LexState): void {
  const next = lex.command.charAt(lex.index + 1);
  lex.raw += next;
  // Inside double quotes bash only unescapes $ ` " \ and the newline
  // (a line continuation). A backslash before any other character,
  // including `n`, stays a literal backslash in the value.
  if (next === "\n" || next === "\r") {
    lex.index += 2;
    return;
  }
  if ('$`"\\'.includes(next)) {
    appendValue(lex, next, true);
    lex.index += 2;
    return;
  }
  appendValue(lex, "\\", true);
  lex.index += 1;
}

function lexDoubleQuoted(lex: LexState, c: string): void {
  lex.raw += c;
  if (c === '"') {
    lex.inDouble = false;
    lex.index += 1;
  } else if (c === "\\" && lex.index + 1 < lex.command.length) {
    lexDoubleQuotedEscape(lex);
  } else {
    appendValue(lex, c, true);
    lex.index += 1;
  }
}

function openQuote(lex: LexState, c: string): void {
  if (c === "'") lex.inSingle = true;
  else lex.inDouble = true;
  lex.raw += c;
  lex.hasToken = true;
  lex.index += 1;
}

function appendUnquoted(lex: LexState, c: string): void {
  appendValue(lex, c, false);
  lex.raw += c;
  lex.hasToken = true;
  lex.index += 1;
}

// Redirection operators may contain characters that are command separators
// elsewhere. Keep `&>`, `2>&1`, and `>|file` inside the token so the
// redirection normalizer below can interpret them as one shell construct
// instead of inventing extra commands.
function gluesToRedirection(lex: LexState, c: string): boolean {
  if (c === "&" && lex.command[lex.index + 1] === ">") return true;
  if (c !== "&" && c !== "|") return false;
  return (
    lex.value.endsWith(">") &&
    !tokenCharIsQuoted(
      { raw: lex.raw, value: lex.value, spans: lex.spans },
      lex.value.length - 1,
    )
  );
}

function lexSeparator(lex: LexState, c: string): void {
  // Capture the operator identity (including doubled `||`/`&&`) so
  // evidence consumers can reason about how segments relate.
  let endedBy = c === "\n" || c === "\r" ? ";" : c;
  if ((c === "|" || c === "&") && lex.command[lex.index + 1] === c) {
    endedBy = `${c}${c}`;
    lex.index += 1;
  }
  flushSegment(lex, endedBy);
  lex.lastSeparator = endedBy;
  lex.index += 1;
}

function skipComment(lex: LexState): void {
  // Line comment: consume until newline (newline itself closes the segment).
  while (lex.index < lex.command.length && lex.command[lex.index] !== "\n")
    lex.index += 1;
}

function lexEscape(lex: LexState): void {
  const next = lex.command.charAt(lex.index + 1);
  lex.raw += `\\${next}`;
  // Backslash-newline is a line continuation outside quotes: both
  // characters vanish, so `r\<newline>m` lexes as the token `rm`.
  if (next !== "\n" && next !== "\r") {
    appendValue(lex, next, true);
    lex.hasToken = true;
  }
  lex.index += 2;
}

function lexUnquoted(lex: LexState, c: string): void {
  if (c === "'" || c === '"') {
    openQuote(lex, c);
    return;
  }
  if (gluesToRedirection(lex, c)) {
    appendUnquoted(lex, c);
    return;
  }
  if (SEPARATORS.has(c)) {
    lexSeparator(lex, c);
    return;
  }
  if (WHITESPACE.has(c)) {
    flushToken(lex);
    lex.index += 1;
    return;
  }
  if (c === "#" && !lex.hasToken) {
    skipComment(lex);
    return;
  }
  if (c === "\\" && lex.index + 1 < lex.command.length) {
    lexEscape(lex);
    return;
  }
  appendUnquoted(lex, c);
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
  const lex: LexState = {
    command,
    budget: state,
    index: 0,
    segments: [],
    tokens: [],
    value: "",
    raw: "",
    hasToken: false,
    spans: [],
    inSingle: false,
    inDouble: false,
    lastSeparator: undefined,
    outOfTokens: false,
  };
  while (lex.index < command.length) {
    if (lex.outOfTokens) break;
    const c = command.charAt(lex.index);
    if (lex.inSingle) lexSingleQuoted(lex, c);
    else if (lex.inDouble) lexDoubleQuoted(lex, c);
    else lexUnquoted(lex, c);
  }
  if (!lex.outOfTokens) flushSegment(lex);
  return lex.segments;
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
