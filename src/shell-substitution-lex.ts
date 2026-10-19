// Lexes the command a substitution runs into segments of its own, for the scan of the word that holds it.

import {
  appendValue,
  type LexState,
  type SubstitutionBudget,
  substitutionScanOf,
} from "./shell-lex-state.ts";
import { lexSegments } from "./shell-scanner.ts";
import { substitutionAt } from "./shell-substitution.ts";

/** Lex the body of a command substitution into segments of its own, under
 *  the same budget. */
function lexBody(
  lex: LexState,
  budget: SubstitutionBudget,
  text: string,
  end: number,
): void {
  lex.substitutionEnd = end;
  budget.substitutionCharsRemaining -= text.length;
  if (budget.substitutionCharsRemaining < 0) budget.tokensRemaining = 0;
  else {
    for (const segment of lexSegments(text, budget))
      lex.substitutions.push(segment);
  }
  if (budget.tokensRemaining <= 0) lex.outOfTokens = true;
}

/** Lex the command substitutions inside text that spans `[from, to)` and is
 *  kept in its word whole: the expression of a double-quoted `$((…))`, or a
 *  `${…}` expansion in double quotes. A substitution there runs even between
 *  quotes. The `${` of a nested expansion is stepped over: the end of the
 *  outer one is already known. */
function lexNested(
  lex: LexState,
  budget: SubstitutionBudget,
  from: number,
  to: number,
): void {
  let index = from;
  while (index < to && !lex.outOfTokens) {
    if (lex.command.startsWith("${", index)) {
      index += 2;
      continue;
    }
    const body = substitutionAt(
      lex.command,
      index,
      true,
      true,
      budget.reading ?? "default",
      "bash",
    );
    if (body?.kind === "command") {
      lexBody(lex, budget, body.text, body.end);
      index = body.end;
    } else index += lex.command[index] === "\\" ? 2 : 1;
  }
}

/** Add the substitution that starts at the current character to the word as
 *  written, quoted inside double quotes, and continue after it. */
function keepInWord(lex: LexState, end: number): void {
  const stop = Math.min(end, lex.command.length);
  const text = lex.command.slice(lex.index, stop);
  appendValue(lex, text, lex.inDouble);
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
 *  character itself is still scanned as part of the enclosing word. Returns
 *  whether the scan moved past a substitution. */
function lexOne(lex: LexState, budget: SubstitutionBudget): boolean {
  if (lex.index < lex.substitutionEnd) return false;
  const scan = substitutionScanOf(budget.quoting);
  const body = substitutionAt(
    lex.command,
    lex.index,
    lex.inDouble,
    lex.index < lex.arithmeticEnd,
    budget.reading ?? "default",
    scan,
  );
  if (body === undefined) return false;
  if (scan !== "bash") {
    if (body.kind === "arithmetic") lex.arithmeticEnd = body.end;
    else if (body.kind === "command") lexBody(lex, budget, body.text, body.end);
    return false;
  }
  if (body.kind === "arithmetic")
    lexNested(lex, budget, lex.index + 3, body.end - 2);
  else if (body.kind === "expansion")
    lexNested(lex, budget, lex.index + 2, body.end - 1);
  else lexBody(lex, budget, body.text, body.end);
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
