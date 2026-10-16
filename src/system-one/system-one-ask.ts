import type { ReviewAttempt } from "../core/review-attempt.ts";
import type { ReviewEnvelope, ReviewerConfig } from "../types.ts";
import {
  enforceParsedSystemOneReview,
  parseSystemOneReview,
} from "./review.ts";
import type { JevOutcome } from "./system-one-handoff.ts";
import {
  createSystemOneInvoker,
  type SystemOneInvoke,
  systemOneState,
} from "./system-one-invoker.ts";

/** Jev's answer, parsed and enforced. Never throws: a failure is an outcome
 *  the hand-off decision can route. */
export async function askJev(
  config: ReviewerConfig,
  invoke: SystemOneInvoke | undefined,
  envelope: ReviewEnvelope,
  attempt: ReviewAttempt,
): Promise<JevOutcome> {
  try {
    const state = systemOneState(envelope, config);
    const response = await attempt.wait(
      (invoke ?? createSystemOneInvoker(config))(state, attempt.signal),
    );
    const parsed = parseSystemOneReview(response, config);
    if (!parsed) return { kind: "invalid" };
    return {
      kind: "valid",
      parsed,
      enforced: enforceParsedSystemOneReview(parsed, config),
    };
  } catch (error) {
    return { kind: "failure", error };
  }
}
