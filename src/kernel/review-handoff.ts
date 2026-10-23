import type { HandoffTrigger, ReviewExecutionResult } from "./review-result.ts";

/** Jev's hand-off to the reasoning reviewer, on the second "reviewing" status
 *  and on the result of a handed-off review. */
export interface HandoffInfo {
  from: string;
  to: string;
  trigger: HandoffTrigger;
  /** Jev's failure ("timeout"), only when `trigger` is `jev-failure`. */
  failureKind?: string;
}

/** Called at most once per review, right before the reasoning reviewer is
 *  invoked; never on the budget-floor or inactive-attempt paths. */
export type OnHandoff = (handoff: HandoffInfo) => void;

/** The reasoning reviewer a Jev result was handed to. */
export interface ReasoningHandoff {
  model: string;
  /** Jev rated the request critical, and its rating holds. */
  jevCritical: boolean;
  escalatedFrom: Required<
    NonNullable<ReviewExecutionResult["reviewerEscalatedFrom"]>
  >;
}
