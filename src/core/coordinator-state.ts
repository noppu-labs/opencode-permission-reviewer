// The review coordinator's shared state, built once per coordinator, and the
// supersede check and result every review step uses.
import { randomUUID } from "node:crypto";
import { reviewBudgetMs } from "../config.ts";
import type { AskDecisionSource } from "../context/ask-decisions.ts";
import { defaultEvidenceProviders } from "../context/evidence-assembler.ts";
import type { EvidenceProvider } from "../evidence/provider.ts";
import type { RuntimeContext } from "../opencode/types.ts";
import {
  createV1ReviewerBackend,
  type V1ReviewBackend,
} from "../opencode/v1/backend-factory.ts";
import type {
  PermissionRequest,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../types.ts";
import { ScriptAnalysisRegistry } from "../verified-ssh-script.ts";
import { recordReviewerMs } from "./attempt-evidence.ts";
import { ReviewAttempt } from "./review-attempt.ts";

export type Logger = (message: string, details?: unknown) => void;

export interface CoordinatorState {
  readonly ctx: RuntimeContext;
  readonly config: ReviewerConfig;
  readonly generation: string;
  readonly attempts: Map<string, ReviewAttempt>;
  stopped: boolean;
  /**
   * Request IDs a human (or any other reply source) resolved while the
   * automatic review was in flight; that review then gives up with no UI
   * status and no reply. OpenCode resolves a request first-writer-wins, so a
   * late programmatic reply gets 404 `PermissionNotFoundError`, which
   * `sendPermissionReply` treats the same way.
   */
  readonly resolvedManually: Set<string>;
  readonly log: Logger;
  readonly backend: V1ReviewBackend;
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
  ctx: RuntimeContext,
  config: ReviewerConfig,
  logger?: Logger,
  providers?: EvidenceProvider[],
  askDecisions?: AskDecisionSource,
): CoordinatorState {
  const log = logger ?? ((): void => {});
  const state: CoordinatorState = {
    ctx,
    config,
    generation: randomUUID(),
    attempts: new Map<string, ReviewAttempt>(),
    stopped: false,
    resolvedManually: new Set<string>(),
    log,
    backend: createV1ReviewerBackend(ctx, config, log, (envelope, ms) =>
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
