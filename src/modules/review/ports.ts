import type { OnHandoff } from "../../kernel/review-handoff.ts";
import type { ReviewExecutionResult } from "../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../kernel/reviewer-config.ts";
import type { Logger } from "../../utils/logger.ts";
import type { ReviewAuditRecord } from "../audit/models/audit-record.ts";
import type { ReviewEnvelope } from "../context/models/review-envelope.ts";
import type { ContextReader } from "../context/ports.ts";
import type { ReviewUiStatus } from "../status/models/ui-protocol.ts";
import type { ReviewAttempt } from "./services/review-attempt.ts";

/** A host call's outcome: failures arrive as `error`, not as a rejection. */
interface HostResponse {
  error?: unknown;
}

/** The host members a review reads and calls. The coordinator keeps the
 *  object it is given, so later changes to these members are seen. */
export interface ReviewHostContext {
  hostVersion?: string;
  directory: string;
  worktree: string;
  permissionReply(options: unknown): Promise<HostResponse>;
  publishUiStatus?(status: ReviewUiStatus): Promise<HostResponse>;
  writeAudit?(record: ReviewAuditRecord): Promise<void>;
}

export interface ReviewerBackend {
  owns(sessionID: string): boolean;
  review(
    envelope: ReviewEnvelope,
    attempt: ReviewAttempt,
    onHandoff?: OnHandoff,
  ): Promise<ReviewExecutionResult>;
  waitForIdle(): Promise<void>;
}

/** What the review coordinator needs from the host. */
export interface ReviewHost {
  readonly context: ReviewHostContext;
  createReviewerBackend(
    config: ReviewerConfig,
    log: Logger,
    recordReviewerMs: (envelope: ReviewEnvelope, ms: number) => void,
  ): ReviewerBackend;
  createContextReader(signal?: AbortSignal): ContextReader;
  /** Whether a reply error means another source already resolved the request. */
  isAlreadyResolvedError(error: unknown): boolean;
}
