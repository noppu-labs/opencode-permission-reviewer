import type { Plugin } from "@opencode/plugin";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import type { V2HostApi } from "./host-api.ts";
import { registerReviewerHooks } from "./v2-review-hooks.ts";
import {
  openReviewerLocation,
  type ReviewerLocation,
} from "./v2-review-location.ts";
import type { PendingGeneration } from "./v2-review-pending.ts";
import { runV2Review, type V2ReviewRun } from "./v2-review-run.ts";

type Context = Parameters<Plugin.Plugin["setup"]>[0];

/** Owns auxiliary sessions and host hooks, never operational permission replies. */
export class V2ReviewerBackend {
  private readonly sessions = new Map<string, PendingGeneration>();
  private readonly jobs = new Set<Promise<ReviewExecutionResult>>();
  private readonly locationAbort = new AbortController();
  private readonly run: V2ReviewRun;
  private locationPromise: Promise<ReviewerLocation> | undefined;
  private disposal?: Promise<void>;
  private closing = false;
  constructor(
    private readonly ctx: Context,
    config: ReviewerConfig,
  ) {
    this.run = {
      config,
      sessions: this.sessions,
      location: (client: V2HostApi): Promise<ReviewerLocation> =>
        this.ensureLocation(client),
    };
  }

  owns(sessionID: string): boolean {
    return this.sessions.has(sessionID);
  }

  register(ctx: Context = this.ctx): Promise<() => Promise<void>> {
    return registerReviewerHooks(ctx, this.sessions);
  }

  review(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    client: V2HostApi,
  ): Promise<ReviewExecutionResult> {
    if (this.closing) throw new Error("Reviewer backend is shutting down");
    if (this.sessions.size >= 64)
      throw new Error("Reviewer session cleanup capacity exhausted");
    const job = runV2Review(this.run, envelope, attempt, client).finally(() =>
      this.jobs.delete(job),
    );
    this.jobs.add(job);
    return job;
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled([...this.jobs]);
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.locationAbort.abort(new Error("Reviewer backend is shutting down"));
    this.disposal = (async () => {
      await this.waitForIdle();
      const location = await this.locationPromise?.catch(() => undefined);
      // An uncertain session deletion must retain the guards in its cached location.
      if (!location || this.sessions.size > 0) return;
      try {
        await location.dispose();
      } finally {
        location.release();
      }
    })();
    return this.disposal;
  }

  private ensureLocation(client: V2HostApi): Promise<ReviewerLocation> {
    if (this.locationPromise) return this.locationPromise;
    const location = openReviewerLocation(client, {
      closing: (): boolean => this.closing,
      register: (ctx: Context): Promise<() => Promise<void>> =>
        this.register(ctx),
      signal: this.locationAbort.signal,
    });
    this.locationPromise = location;
    void location.catch(() => {
      if (this.locationPromise === location) this.locationPromise = undefined;
    });
    return location;
  }
}
