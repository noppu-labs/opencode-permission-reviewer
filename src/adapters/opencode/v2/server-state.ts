// The V2 server's state for one setup: the loaded config and its services,
// the pending reviews, the retained tool inputs, and the notifications and UI
// statuses the hooks share.
import { createHash, randomUUID } from "node:crypto";
import type { Plugin } from "@opencode/plugin";
import type { PermissionEvaluation } from "@opencode/plugin/promise/permission";
import { createAuditWriter } from "../../../modules/audit/services/audit.ts";
import type { loadResolvedConfig } from "../../../modules/config/services/loader.ts";
import { ScriptAnalysisRegistry } from "../../../modules/evidence/ssh/verified-ssh-script.ts";
import type { NormalizedReviewRequest } from "../../../modules/review/models/contracts.ts";
import type { ReviewAttempt } from "../../../modules/review/services/review-attempt.ts";
import { isSystemOneReviewerModel } from "../../../modules/reviewer/services/reviewer-model.ts";
import type { ReviewUiStatus } from "../../../modules/status/models/ui-protocol.ts";
import type { ReviewEnvelope } from "../../../types.ts";
import type { V2ReviewBackend } from "./backend-factory.ts";
import type { resolveV2Host } from "./connection.ts";
import { V2AskDecisions } from "./event-codec.ts";

export type Context = Parameters<Plugin.Plugin["setup"]>[0];
type Config = ReturnType<typeof loadResolvedConfig>;

export interface ServerServices {
  loadConfig: typeof loadResolvedConfig;
  connect: typeof resolveV2Host;
  createBackend(context: Context, config: Config): V2ReviewBackend;
}

export interface PendingReview {
  attempt: ReviewAttempt;
  sessionID: string;
  work?: Promise<void>;
}

/** One permission evaluation under review and what it has gathered so far. */
export interface ReviewRun {
  readonly input: PermissionEvaluation;
  readonly attempt: ReviewAttempt;
  readonly budget: number;
  actionSnapshot?: string;
  normalized?: NormalizedReviewRequest;
  envelope?: ReviewEnvelope;
}

export interface ServerState {
  readonly ctx: Context;
  readonly services: ServerServices;
  readonly directory: string;
  readonly config: Config;
  readonly systemOneReviewer: boolean;
  readonly generation: string;
  readonly identity: string;
  readonly backend: V2ReviewBackend;
  readonly scriptRegistry: ScriptAnalysisRegistry;
  readonly askDecisions: V2AskDecisions | undefined;
  readonly requests: Map<string, PendingReview>;
  readonly tools: Map<string, { input: unknown }>;
  readonly notifications: Set<Promise<unknown>>;
  readonly statuses: Map<string, ReviewUiStatus>;
  revision: number;
  disposed: boolean;
  cleanupStarted: boolean;
  eventStreamHealthy: boolean;
  connectionState: "not-probed" | "verified" | "failed";
  readonly subscription: AbortController;
  readonly log: (message: string, details?: unknown) => void;
  readonly audit: ReturnType<typeof createAuditWriter>;
  readonly effectiveConfigHash: string;
  readonly registrations: Array<{ dispose(): Promise<void> }>;
}

export function createServerState(
  ctx: Context,
  services: ServerServices,
): ServerState {
  const directory = ctx.location.directory;
  const config = services.loadConfig(ctx.options, directory, "unknown");
  const systemOneReviewer = isSystemOneReviewerModel(config.model);
  const generation = randomUUID();
  const identity = randomUUID();
  const backend = services.createBackend(ctx, config);
  const scriptRegistry = new ScriptAnalysisRegistry();
  const askDecisions = config.askDecisions ? new V2AskDecisions() : undefined;
  const log = (message: string, details?: unknown): void =>
    console.error(`[opencode-permission-reviewer] ${message}`, details ?? "");
  return {
    ctx,
    services,
    directory,
    config,
    systemOneReviewer,
    generation,
    identity,
    backend,
    scriptRegistry,
    askDecisions,
    requests: new Map(),
    tools: new Map(),
    notifications: new Set(),
    statuses: new Map(),
    revision: 0,
    disposed: false,
    cleanupStarted: false,
    eventStreamHealthy: true,
    connectionState: "not-probed",
    subscription: new AbortController(),
    log,
    audit: createAuditWriter(config, log),
    effectiveConfigHash: createHash("sha256")
      .update(JSON.stringify(config))
      .digest("hex"),
    registrations: [],
  };
}
