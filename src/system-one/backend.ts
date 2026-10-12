import type { ReviewAttempt } from "../core/review-attempt.ts";
import { applyEscalationDisposition } from "../escalation.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../types.ts";
import {
  enforceParsedSystemOneReview,
  parseSystemOneReview,
} from "./review.ts";
import {
  createSystemOneInvoker,
  type SystemOneInvoke,
  systemOneState,
} from "./system-one-invoker.ts";
import {
  invalidDecisionResult,
  type ReasoningHandoff,
  reasoningResult,
  reviewerFailureResult,
  systemOneResult,
} from "./system-one-results.ts";
import type { SystemOneScores } from "./system-one-types.ts";

export type ReasoningEscalation = (
  envelope: ReviewEnvelope,
  attempt: ReviewAttempt,
) => Promise<ReviewExecutionResult>;

/** Calls Jev directly and delegates only valid but difficult decisions. */
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
    let systemOne: SystemOneScores | undefined;
    let reasoning: ReasoningHandoff | undefined;
    try {
      const state = systemOneState(envelope, this.config);
      const response = await attempt.wait(
        (this.invoke ?? createSystemOneInvoker(this.config))(
          state,
          attempt.signal,
        ),
      );
      const parsed = parseSystemOneReview(response, this.config);
      if (!parsed) return invalidDecisionResult(this.config);
      systemOne = parsed.scores;

      const enforced = enforceParsedSystemOneReview(parsed, this.config);
      if (enforced.kind !== "escalate")
        return systemOneResult(enforced, this.config, systemOne);

      if (escalation && this.escalationModel && parsed.reasoningRecommended) {
        reasoning = {
          model: this.escalationModel,
          escalatedFrom: { model: this.config.model, reason: enforced.reason },
        };
        return reasoningResult(
          await escalation(envelope, attempt),
          reasoning,
          systemOne,
        );
      }

      return applyEscalationDisposition(
        systemOneResult(enforced, this.config, systemOne),
        this.config,
        "general",
      );
    } catch (error) {
      return reviewerFailureResult(this.config, error, systemOne, reasoning);
    } finally {
      const elapsed = performance.now() - started;
      envelope.timings = { ...envelope.timings, reviewerMs: elapsed };
      this.recordReviewerMs?.(envelope, elapsed);
    }
  }
}
