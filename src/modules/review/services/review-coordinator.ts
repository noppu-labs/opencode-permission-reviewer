import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { Logger } from "../../../utils/logger.ts";
import { withTimeout } from "../../../utils/with-timeout.ts";
import type { AskDecisionSource } from "../../context/services/ask-decisions.ts";
import type { EvidenceProvider } from "../../evidence/providers/provider.ts";
import type { ReviewHost } from "../ports.ts";
import { writeReviewAudit } from "./audit-record/review-coordinator-support.ts";
import {
  type CoordinatorState,
  coordinatorState,
  isSuperseded,
  startAttempt,
  supersedeResult,
} from "./coordinator-state.ts";
import { supersedeOnReply } from "./reply-events.ts";
import {
  applyFailureDisposition,
  failureDisposition,
  logReviewFailure,
} from "./review-disposition.ts";
import { ReviewLimiter } from "./review-limiter.ts";
import { processRequest } from "./review-pipeline.ts";

/**
 * Owns the review lifecycle for permission requests: orchestration, the
 * supersede state machine, and the model call. The adapter (transport) and the
 * evidence providers are injected so this class stays focused on ordering and
 * races.
 */
export class ReviewCoordinator {
  private readonly state: CoordinatorState;
  private readonly limiter = new ReviewLimiter();
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    host: ReviewHost,
    config: ReviewerConfig,
    logger?: Logger,
    providers?: EvidenceProvider[],
    askDecisions?: AskDecisionSource,
  ) {
    this.state = coordinatorState(
      host,
      config,
      logger,
      providers,
      askDecisions,
    );
  }

  pendingCount(): number {
    return this.pending.size;
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.pending.values()]);
  }

  async dispose(): Promise<void> {
    const state = this.state;
    state.stopped = true;
    for (const attempt of state.attempts.values()) attempt.close("cancelled");
    await withTimeout(
      Promise.all([this.waitForIdle(), state.backend.waitForIdle()]),
      12_000,
    ).catch((error) => state.log("Reviewer shutdown timed out", String(error)));
  }

  handle(request: PermissionRequest): void {
    if (this.state.stopped) return;
    if (this.pending.has(request.id)) return;

    const task = this.process(request)
      .catch((error) => logReviewFailure(this.state, request, error))
      .finally(() => {
        this.pending.delete(request.id);
        // Prune so the set cannot grow unboundedly across a long session.
        this.state.resolvedManually.delete(request.id);
      });
    this.pending.set(request.id, task);
  }

  async process(request: PermissionRequest): Promise<ReviewExecutionResult> {
    const state = this.state;
    const startedAt = Date.now();
    const attempt = startAttempt(state);
    state.attempts.set(request.id, attempt);
    let release: (() => void) | undefined;
    try {
      release = await this.limiter.acquire(attempt.signal);
      const result = await attempt.wait(processRequest(state, request));
      await writeReviewAudit(state, request, result, startedAt);
      return result;
    } catch (error) {
      if (isSuperseded(state, request)) {
        const result = supersedeResult();
        await writeReviewAudit(state, request, result, startedAt);
        return result;
      }
      const disposed = failureDisposition(state.config, error);
      try {
        await applyFailureDisposition(state, attempt, request, disposed);
      } catch (applicationError) {
        state.log(
          "failure disposition could not be confirmed",
          String(applicationError),
        );
      }
      await writeReviewAudit(state, request, disposed, startedAt);
      throw error;
    } finally {
      attempt.close("finished");
      state.attempts.delete(request.id);
      release?.();
    }
  }

  handlePermissionReply(event: unknown): void {
    supersedeOnReply(this.state, this.pending, event);
  }

  /**
   * @deprecated No-op. Approvals no longer annotate tool results so they do not
   * contaminate the primary agent context. Kept for public API compatibility;
   * the plugin no longer registers a host hook that calls this. Rationale
   * remains in audit, TUI, and debug.
   */
  annotateToolResult(
    // biome-ignore lint/correctness/noUnusedFunctionParameters: deprecated public no-op keeps its documented parameter name
    callID: string,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: deprecated public no-op keeps its documented parameter name
    output: { output?: unknown; metadata?: unknown },
  ): void {
    // Intentionally empty — asymmetric feedback: allow is silent to the agent.
  }
}
