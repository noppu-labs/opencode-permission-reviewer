import type { ReviewAttemptView } from "../../../kernel/review-attempt.ts";
import type {
  OnHandoff,
  ReasoningHandoff,
} from "../../../kernel/review-handoff.ts";
import type {
  ReviewExecutionResult,
  SystemOneScores,
} from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { resolveSystemOneRouting } from "../../config/services/system-one-routing.ts";
import type { ReviewEnvelope } from "../../context/models/review-envelope.ts";
import { announceHandoff } from "../../status/services/ui-status-routing.ts";
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
  reasoningFailureResult,
  reasoningResult,
} from "./system-one-results.ts";

export type ReasoningEscalation<
  Attempt extends ReviewAttemptView = ReviewAttemptView,
> = (
  envelope: ReviewEnvelope,
  attempt: Attempt,
) => Promise<ReviewExecutionResult>;

/** Calls Jev directly and hands its result to the reasoning reviewer at most
 *  once, when the hand-off decision says so. */
export class SystemOneReviewerBackend<
  Attempt extends ReviewAttemptView = ReviewAttemptView,
> {
  private readonly jobs = new Set<Promise<ReviewExecutionResult>>();

  constructor(
    private readonly config: ReviewerConfig,
    private readonly escalation?: ReasoningEscalation<Attempt>,
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
    attempt: Attempt,
    escalation: ReasoningEscalation<Attempt> | undefined = this.escalation,
    onHandoff?: OnHandoff,
  ): Promise<ReviewExecutionResult> {
    const job = this.runReview(
      envelope,
      attempt,
      escalation,
      onHandoff,
    ).finally(() => this.jobs.delete(job));
    this.jobs.add(job);
    return job;
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.jobs]);
  }

  private async runReview(
    envelope: ReviewEnvelope,
    attempt: Attempt,
    escalation: ReasoningEscalation<Attempt> | undefined,
    onHandoff: OnHandoff | undefined,
  ): Promise<ReviewExecutionResult> {
    const started = performance.now();
    try {
      const jev = await askJev(this.config, this.invoke, envelope, attempt);
      return await this.route(jev, envelope, attempt, escalation, onHandoff);
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
    attempt: Attempt,
    escalation: ReasoningEscalation<Attempt> | undefined,
    onHandoff: OnHandoff | undefined,
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
    announceHandoff(onHandoff, handoff);
    return this.handOff(envelope, attempt, escalation, handoff, jevScores(jev));
  }

  private async handOff(
    envelope: ReviewEnvelope,
    attempt: Attempt,
    escalation: ReasoningEscalation<Attempt>,
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
