// Lexes the command a substitution runs into segments of its own, for the scan of the word that holds it.

import type { LexState, SubstitutionBudget } from "./shell-lex-state.ts";
import { lexSegments } from "./shell-scanner.ts";
import { substitutionAt } from "./shell-substitution.ts";

/** Lex the body of a substitution that opens at the current character
 *  into segments of its own, under the same budget. The character itself is
 *  still scanned as part of the enclosing word. */
export function lexSubstitution(
  lex: LexState,
  budget: SubstitutionBudget,
): void {
  if (lex.index < lex.substitutionEnd) return;
  const body = substitutionAt(
    lex.command,
    lex.index,
    lex.inDouble,
    lex.index < lex.arithmeticEnd,
    budget.reading ?? "default",
  );
  if (body === undefined) return;
  if (body.kind === "arithmetic") {
    lex.arithmeticEnd = body.end;
    return;
  }
  lex.substitutionEnd = body.end;
  budget.substitutionCharsRemaining -= body.text.length;
  if (budget.substitutionCharsRemaining < 0) budget.tokensRemaining = 0;
  else {
    for (const segment of lexSegments(body.text, budget))
      lex.substitutions.push(segment);
  }
  if (budget.tokensRemaining <= 0) lex.outOfTokens = true;
}
