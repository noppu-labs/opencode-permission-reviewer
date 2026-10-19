// Lexes the command a substitution runs into segments of its own, for the scan of the word that holds it.

import { keepBodyCommands } from "./capability/heredoc-body-commands.ts";
import {
  appendValue,
  type LexState,
  type SubstitutionBudget,
  substitutionScanOf,
} from "./shell-lex-state.ts";
import { lexSegments } from "./shell-scanner.ts";
import {
  type FrameCloses,
  type SubstitutionBody,
  substitutionAt,
} from "./shell-substitution.ts";
import { uncertainRegion } from "./shell-substitution-trust.ts";

type CommandBody = Extract<SubstitutionBody, { kind: "command" }>;

/** Lex the body of a command substitution into segments of its own, under
 *  the same budget, and keep the commands its heredocs run. */
function lexBody(
  lex: LexState,
  budget: SubstitutionBudget,
  body: CommandBody,
): void {
  const { text, end } = body;
  keepBodyCommands(budget.bodies, body.bodyCommands, body.bodyUnresolved);
  lex.substitutionEnd = end;
  budget.substitutionCharsRemaining -= text.length;
  if (budget.substitutionCharsRemaining < 0) budget.tokensRemaining = 0;
  else {
    for (const segment of lexSegments(text, budget))
      lex.substitutions.push(segment);
  }
  if (budget.tokensRemaining <= 0) lex.outOfTokens = true;
}

/** Where the walk over kept text is, and where each frame inside it closed. */
interface Walk {
  index: number;
  closes: FrameCloses;
}

/** Whether the `$((` at `index` is arithmetic, by the frames the end-finder
 *  already closed: its subshell frame closes right before its own. */
function knownArithmetic(closes: FrameCloses, index: number): boolean {
  const outer = closes.get(index) ?? closes.get(index + 1);
  const inner = closes.get(index + 2);
  return outer !== undefined && inner !== undefined && outer === inner + 1;
}

/** Charge the text of a probe that found arithmetic to the substitution
 *  budget. It reads text again, so a deep nest of unknown `$((` costs a
 *  bounded amount in all. */
function chargeProbe(
  lex: LexState,
  budget: SubstitutionBudget,
  size: number,
): void {
  budget.substitutionCharsRemaining -= size;
  if (budget.substitutionCharsRemaining >= 0) return;
  budget.tokensRemaining = 0;
  lex.outOfTokens = true;
}

function stepNested(
  lex: LexState,
  budget: SubstitutionBudget,
  walk: Walk,
): void {
  const { command } = lex;
  if (command.startsWith("${", walk.index)) {
    walk.index += 2;
    return;
  }
  if (
    command.startsWith("$((", walk.index) &&
    knownArithmetic(walk.closes, walk.index)
  ) {
    walk.index += 1;
    return;
  }
  const body = substitutionAt(
    command,
    walk.index,
    true,
    false,
    budget.reading ?? "default",
    "bash",
    budget,
  );
  if (body?.kind === "command") {
    lexBody(lex, budget, body);
    walk.index = body.end;
    return;
  }
  if (body?.kind === "arithmetic")
    chargeProbe(lex, budget, body.end - walk.index);
  walk.index += command[walk.index] === "\\" ? 2 : 1;
}

/** Lex the command substitutions inside text that spans `[from, to)` and is
 *  kept in its word whole: the expression of a double-quoted `$((…))`, or a
 *  `${…}` expansion in double quotes. A substitution there runs even between
 *  quotes. The `${` of a nested expansion is stepped over: the end of the
 *  outer one is already known. A `$((` is arithmetic, or a subshell inside a
 *  command substitution (`$((cmd) )`), which the shell runs in both places;
 *  `closes` says which for the ones the end-finder already read. */
function lexNested(
  lex: LexState,
  budget: SubstitutionBudget,
  from: number,
  to: number,
  closes: FrameCloses,
): void {
  const walk: Walk = { index: from, closes };
  while (walk.index < to && !lex.outOfTokens) stepNested(lex, budget, walk);
}

/** Add the substitution that starts at the current character to the word as
 *  written, and continue after it. Inside double quotes it is quoted; outside
 *  it stays unquoted but opaque, so no operator in it acts on the outer
 *  command. */
function keepInWord(lex: LexState, end: number): void {
  const stop = Math.min(end, lex.command.length);
  const text = lex.command.slice(lex.index, stop);
  appendValue(lex, text, lex.inDouble, !lex.inDouble);
  lex.raw += text;
  lex.hasToken = true;
  lex.dollarRun = 0;
  lex.index = stop;
}

/** Lex the body of the substitution that opens at the current character into
 *  segments of its own, under the same budget. Under `bash` the whole
 *  substitution then joins the enclosing word and the scan continues after
 *  it: the text of a body is lexed once and never walked in the quote state
 *  of the word that holds it. Other readings walk it again, and the
 *  character itself is still scanned as part of the enclosing word. A body
 *  the shell's reading finds no end for, or an end it cannot be sure of, is
 *  read, with all the text after it, as the previous release read it. Returns whether the scan moved past
 *  a substitution. */
function lexOne(lex: LexState, budget: SubstitutionBudget): boolean {
  if (lex.index < lex.substitutionEnd) return false;
  const scan = lex.previousReading
    ? "previous"
    : substitutionScanOf(budget.quoting);
  const body = substitutionAt(
    lex.command,
    lex.index,
    lex.inDouble,
    lex.index < lex.arithmeticEnd,
    budget.reading ?? "default",
    scan,
    budget,
  );
  if (body === undefined) return false;
  if (scan === "bash" && !trusted(lex, body.end)) {
    lex.previousReading = true;
    return lexOne(lex, budget);
  }
  if (scan === "bash") return jumpPast(lex, budget, body);
  if (body.kind === "arithmetic") lex.arithmeticEnd = body.end;
  else if (body.kind === "command") lexBody(lex, budget, body);
  return false;
}

/** Whether the shell's reading can be sure the substitution at the current
 *  character ends just before `end`. */
function trusted(lex: LexState, end: number): boolean {
  return end <= lex.command.length && !uncertainRegion(lex, lex.index, end);
}

/** Lex what the substitution holds, then keep its text in the word and
 *  continue after it. */
function jumpPast(
  lex: LexState,
  budget: SubstitutionBudget,
  body: SubstitutionBody,
): boolean {
  if (body.kind === "arithmetic")
    lexNested(
      lex,
      budget,
      lex.index + 3,
      body.end - 2,
      body.closes ?? new Map(),
    );
  else if (body.kind === "expansion")
    lexNested(lex, budget, lex.index + 2, body.end - 1, body.closes);
  else lexBody(lex, budget, body);
  keepInWord(lex, body.end);
  return true;
}

export function lexSubstitution(
  lex: LexState,
  budget: SubstitutionBudget,
): void {
  while (lexOne(lex, budget) && !lex.outOfTokens) {
    // A substitution may start right where the last one ended.
  }
}
