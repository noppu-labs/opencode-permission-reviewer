// The review coordinator's shared state, built once per coordinator, and the
// supersede check and result every review step uses.
import { randomUUID } from "node:crypto";
import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { Logger } from "../../../utils/logger.ts";
import { reviewBudgetMs } from "../../config/services/config.ts";
import type { AskDecisionSource } from "../../context/services/ask-decisions.ts";
import { defaultEvidenceProviders } from "../../context/services/evidence-assembler.ts";
import type { EvidenceProvider } from "../../evidence/providers/provider.ts";
import { ScriptAnalysisRegistry } from "../../evidence/ssh/verified-ssh-script.ts";
import type {
  ReviewerBackend,
  ReviewHost,
  ReviewHostContext,
} from "../ports.ts";
import { recordReviewerMs } from "./attempt-evidence.ts";
import { ReviewAttempt } from "./review-attempt.ts";

export interface CoordinatorState {
  readonly host: ReviewHost;
  /** The same object as `host.context`. Helpers that need only the host
   *  context pick this field, so their callers and fixtures need not build a
   *  whole `ReviewHost`. */
  readonly ctx: ReviewHostContext;
  readonly config: ReviewerConfig;
  readonly generation: string;
  readonly attempts: Map<string, ReviewAttempt>;
  stopped: boolean;
  /**
   * Request IDs a human (or any other reply source) resolved while the
   * automatic review was in flight; that review then gives up with no UI
   * status and no reply. A late reply to an already-resolved request is
   * recognised by `ReviewHost.isAlreadyResolvedError` and handled the same way.
   */
  readonly resolvedManually: Set<string>;
  readonly log: Logger;
  readonly backend: ReviewerBackend;
  readonly providers: EvidenceProvider[];
  readonly scriptRegistry: ScriptAnalysisRegistry;
  /** Live ask-decision capture (enrichment-only; undefined when disabled). */
  readonly askDecisions: AskDecisionSource | undefined;
  /** Bound for metadata SDK calls (session create, tool listing, replies,
   *  status publishing): a hung call must never leave a review pending
   *  forever; the reviewer prompt keeps its own full timeout budget. */
  readonly metadataCallTimeoutMs: number;
}

export function coordinatorState(
  host: ReviewHost,
  config: ReviewerConfig,
  logger?: Logger,
  providers?: EvidenceProvider[],
  askDecisions?: AskDecisionSource,
): CoordinatorState {
  const log = logger ?? ((): void => {});
  const state: CoordinatorState = {
    host,
    ctx: host.context,
    config,
    generation: randomUUID(),
    attempts: new Map<string, ReviewAttempt>(),
    stopped: false,
    resolvedManually: new Set<string>(),
    log,
    backend: host.createReviewerBackend(config, log, (envelope, ms) =>
      recordReviewerMs(state.attempts, envelope, ms),
    ),
    providers: providers ?? defaultEvidenceProviders(),
    scriptRegistry: new ScriptAnalysisRegistry(),
    askDecisions,
    metadataCallTimeoutMs: Math.min(config.timeoutMs, 10_000),
  };
  return state;
}

export function startAttempt(
  state: Pick<CoordinatorState, "generation" | "config">,
): ReviewAttempt {
  return new ReviewAttempt(state.generation, reviewBudgetMs(state.config));
}

export function isSuperseded(
  state: Pick<CoordinatorState, "stopped" | "resolvedManually">,
  request: PermissionRequest,
): boolean {
  return state.stopped || state.resolvedManually.has(request.id);
}

export function supersedeResult(): ReviewExecutionResult {
  return {
    kind: "escalate",
    reason: "Request already answered manually; automatic review superseded.",
    decisionSource: "manual-superseded",
  };
}
