import type { ReviewAttempt } from "../../core/review-attempt.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../types.ts";
import type { RuntimeContext } from "../types.ts";
import { IsolatedReviewerDirectory } from "./v1-isolated-directory.ts";
import type { V1ReviewRun } from "./v1-review-lifecycle.ts";
import { runV1Review } from "./v1-review-run.ts";

/** Owns isolated reviewer sessions, model calls, and their bounded cleanup. */
export class V1ReviewerBackend {
  private readonly reviewerSessions = new Set<string>();
  private readonly jobs = new Set<Promise<ReviewExecutionResult>>();
  private readonly run: V1ReviewRun;
  constructor(
    ctx: RuntimeContext,
    config: ReviewerConfig,
    private readonly log: (message: string, details?: unknown) => void,
    private readonly recordReviewerMs: (
      envelope: ReviewEnvelope,
      ms: number,
    ) => void,
  ) {
    this.run = {
      ctx,
      config,
      isolatedDirectory: new IsolatedReviewerDirectory(
        ctx,
        (message, details) => this.log(message, details),
      ),
      sessions: this.reviewerSessions,
      metadataCallTimeoutMs: Math.min(config.timeoutMs, 10_000),
      recordReviewerMs: (envelope: ReviewEnvelope, ms: number): void =>
        this.recordReviewerMs(envelope, ms),
    };
  }

  owns(sessionID: string): boolean {
    return this.reviewerSessions.has(sessionID);
  }

  review(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
  ): Promise<ReviewExecutionResult> {
    const job = runV1Review(this.run, envelope, attempt).finally(() =>
      this.jobs.delete(job),
    );
    this.jobs.add(job);
    return job;
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.jobs]);
  }
}
