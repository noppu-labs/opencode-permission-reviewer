import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";
import type { ContextReader } from "../../../modules/context/ports.ts";
import type { AskDecisionSource } from "../../../modules/context/services/ask-decisions.ts";
import type { EvidenceProvider } from "../../../modules/evidence/providers/provider.ts";
import type {
  ReviewerBackend,
  ReviewHost,
} from "../../../modules/review/ports.ts";
import { ReviewCoordinator } from "../../../modules/review/services/review-coordinator.ts";
import type { Logger } from "../../../utils/logger.ts";
import { isAlreadyResolvedError } from "../transport.ts";
import type { RuntimeContext } from "../types.ts";
import { createV1ReviewerBackend } from "./backend-factory.ts";
import { createV1ContextReader } from "./context-reader.ts";

function createV1ReviewHost(ctx: RuntimeContext): ReviewHost {
  return {
    context: ctx,
    createReviewerBackend: (
      config: ReviewerConfig,
      log: Logger,
      recordReviewerMs: (envelope: ReviewEnvelope, ms: number) => void,
    ): ReviewerBackend =>
      createV1ReviewerBackend(ctx, config, log, recordReviewerMs),
    createContextReader: (signal?: AbortSignal): ContextReader =>
      createV1ContextReader(ctx.client, signal),
    isAlreadyResolvedError,
  };
}

/** The review coordinator on a V1 host, built from the host's runtime context. */
export class V1ReviewCoordinator extends ReviewCoordinator {
  constructor(
    ctx: RuntimeContext,
    config: ReviewerConfig,
    logger?: Logger,
    providers?: EvidenceProvider[],
    askDecisions?: AskDecisionSource,
  ) {
    super(createV1ReviewHost(ctx), config, logger, providers, askDecisions);
  }
}
