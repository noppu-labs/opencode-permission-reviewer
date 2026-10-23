// Validation of one Jev choice answer: a known option, a confidence, and
// probabilities over exactly the options that sum to 1 and favour the choice
// (within a tolerance for supporting choices, which Jev rounds to hundredths).

import type { SystemOneChoiceScore } from "../../../kernel/review-result.ts";
import { isRecord } from "../../../utils/is-record.ts";

export type ParsedChoice<T extends string> = SystemOneChoiceScore<T> & {
  probabilities: Record<T, number>;
};

/** Whether `value`'s own keys are exactly `expected`. `Object.keys` never
 *  repeats a key, so a duplicate in `expected` can never match. */
export function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort(); // NOSONAR(S2871) compares key sets; `expected` is sorted the same way below
  const sorted = [...expected].sort(); // NOSONAR(S2871) the same default order as `keys`
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

export function finiteProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/** How far below the most probable option a supporting choice may sit:
 *  Jev's probabilities are rounded to hundredths after it chooses. */
export const SUPPORTING_TIE_TOLERANCE = 0.02;

/** The probabilities of a choice answer: exactly the options, each a
 *  probability, summing to 1 within 0.02, with `choice` at most
 *  `tieTolerance` below the most probable option. */
function choiceProbabilities(
  value: unknown,
  options: readonly string[],
  choice: string,
  tieTolerance = 0,
): Record<string, number> | undefined {
  if (typeof value !== "object" || value === null) return;
  const probabilities = value as Record<string, unknown>;
  if (!exactKeys(probabilities, options)) return;
  const values = Object.values(probabilities);
  if (!values.every(finiteProbability)) return;
  const total = (values as number[]).reduce(
    (sum, probability) => sum + probability,
    0,
  );
  if (total < 0.98 || total > 1.02) return;
  const selected = probabilities[choice] as number;
  if (selected + tieTolerance + 1e-9 < Math.max(...(values as number[])))
    return;
  return probabilities as Record<string, number>;
}

export function parseChoice<T extends readonly string[]>(
  value: unknown,
  options: T,
  tieTolerance = 0,
): ParsedChoice<T[number]> | undefined {
  if (!isRecord(value)) return;
  const answer = value;
  if (answer.type !== "choice" || !options.includes(answer.choice as T[number]))
    return;
  if (!finiteProbability(answer.confidence)) return;
  const probabilities = choiceProbabilities(
    answer.probabilities,
    options,
    answer.choice as T[number],
    tieTolerance,
  );
  if (probabilities === undefined) return;
  return {
    choice: answer.choice as T[number],
    confidence: answer.confidence,
    probabilities: probabilities as Record<T[number], number>,
  };
}
