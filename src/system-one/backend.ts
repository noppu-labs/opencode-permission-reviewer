import type { ReviewAttempt } from "../core/review-attempt.ts";
import { resolveSystemOneRouting } from "../system-one-routing.ts";
import type {
  HandoffTrigger,
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../types.ts";
import { askJev } from "./system-one-ask.ts";
import { budgetExhaustedResult } from "./system-one-budget.ts";
import {
  handoffBlock,
  handoffTrigger,
  type JevOutcome,
  jevCriticalHolds,
} from "./system-one-handoff.ts";
import type { SystemOneInvoke } from "./system-one-invoker.ts";
import {
  finalJevResult,
  handoffReason,
  jevResult,
  jevScores,
  type ReasoningHandoff,
  reasoningFailureResult,
  reasoningResult,
} from "./system-one-results.ts";
import type { SystemOneScores } from "./system-one-types.ts";

export type ReasoningEscalation = (
  envelope: ReviewEnvelope,
  attempt: ReviewAttempt,
) => Promise<ReviewExecutionResult>;

/** The hand-off a host shows while the reasoning reviewer runs. `failureKind`
 *  names Jev's failure ("timeout") when the trigger is `jev-failure`. */
export interface HandoffInfo {
  from: string;
  to: string;
  trigger: HandoffTrigger;
  failureKind?: string;
}

/** Calls Jev directly and hands its result to the reasoning reviewer at most
 *  once, when the hand-off decision says so. */
export class SystemOneReviewerBackend {
  private readonly jobs = new Set<Promise<ReviewExecutionResult>>();

  constructor(
    private readonly config: ReviewerConfig,
    private readonly escalation?: ReasoningEscalation,
    private readonly escalationModel?: string,
    private readonly invoke?: SystemOneInvoke,
    private readonly recordReviewerMs?: (
      envelope: ReviewEnvelope,
      ms: number,
    ) => void,
  ) {}

  owns(): boolean {
    return false;
  }

  review(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    escalation: ReasoningEscalation | undefined = this.escalation,
  ): Promise<ReviewExecutionResult> {
    const job = this.runReview(envelope, attempt, escalation).finally(() =>
      this.jobs.delete(job),
    );
    this.jobs.add(job);
    return job;
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.jobs]);
  }

  private async runReview(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    escalation: ReasoningEscalation | undefined,
  ): Promise<ReviewExecutionResult> {
    const started = performance.now();
    try {
      const jev = await askJev(this.config, this.invoke, envelope, attempt);
      return await this.route(jev, envelope, attempt, escalation);
    } finally {
      const elapsed = performance.now() - started;
      envelope.timings = { ...envelope.timings, reviewerMs: elapsed };
      this.recordReviewerMs?.(envelope, elapsed);
    }
  }

  /** The single hand-off decision: Jev's own result, or one reasoning review. */
  private async route(
    jev: JevOutcome,
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    escalation: ReasoningEscalation | undefined,
  ): Promise<ReviewExecutionResult> {
    const own = jevResult(jev, this.config);
    const routing = resolveSystemOneRouting(this.config);
    const trigger = handoffTrigger(jev, routing);
    const model = this.escalationModel;
    if (trigger === undefined || !escalation || !model)
      return finalJevResult(own, this.config);
    const block = handoffBlock(attempt);
    // Both hosts reject an inactive attempt's result in `attempt.wait`, so Jev's
    // own result here is never applied.
    if (block === "inactive") return finalJevResult(own, this.config);
    if (block === "budget-exhausted")
      return budgetExhaustedResult(
        own,
        trigger,
        attempt.remainingMs(),
        this.config,
      );
    const handoff: ReasoningHandoff = {
      model,
      jevCritical: jevCriticalHolds(jev, trigger, routing),
      escalatedFrom: {
        model: this.config.model,
        reason: handoffReason(jev, own),
        trigger,
      },
    };
    return this.handOff(envelope, attempt, escalation, handoff, jevScores(jev));
  }

  private async handOff(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    escalation: ReasoningEscalation,
    handoff: ReasoningHandoff,
    systemOne: SystemOneScores | undefined,
  ): Promise<ReviewExecutionResult> {
    try {
      return reasoningResult(
        await escalation(envelope, attempt),
        handoff,
        systemOne,
      );
    } catch (error) {
      return reasoningFailureResult(this.config, error, handoff, systemOne);
    }
  }
}
