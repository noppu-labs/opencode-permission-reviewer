import type {
  Hooks,
  Plugin,
  PluginInput,
  PluginOptions,
} from "@opencode-ai/plugin";
import { extractPermissionRequest } from "./adapters/opencode/event-normalizer.ts";
import { probeHostVersion } from "./adapters/opencode/host-version.ts";
import type { RuntimeContext } from "./adapters/opencode/types.ts";
import { createV1Adapter } from "./adapters/opencode/v1-adapter.ts";
import { setup } from "./adapters/opencode/v2/server.ts";
import { createAuditWriter } from "./modules/audit/services/audit.ts";
import { loadResolvedConfig } from "./modules/config/services/loader.ts";
import { AskDecisionRegistry } from "./modules/context/services/ask-decisions.ts";
import { ReviewCoordinator as ApprovalReviewerRuntime } from "./modules/review/services/review-coordinator.ts";

type HookEvent = Parameters<NonNullable<Hooks["event"]>>[0];

export const server: Plugin = async (
  input: PluginInput,
  options?: PluginOptions,
): Promise<Hooks> => {
  // V1 does not report whether plugin options came from global or project
  // config. Treat that unknown provenance like V2: inline values may tighten
  // policy, but only the dedicated global file may select the reviewer or
  // relax trusted restrictions.
  const config = loadResolvedConfig(options, input.directory, "unknown");
  const debugLogger = (message: string, details?: unknown): void => {
    console.error(`[opencode-permission-reviewer] ${message}`, details ?? "");
  };
  const logger = config.debug ? debugLogger : undefined;
  // Audit-write failures stay visible even without debug: the audit trail is
  // the traceability guarantee, and silently losing records hides it.
  const writeAudit = createAuditWriter(
    config,
    config.debug ? logger : debugLogger,
  );
  const probe = probeHostVersion(input.client);
  const hostVersion = probe === undefined ? undefined : await probe;
  const ctx: RuntimeContext = {
    ...(hostVersion ? { hostVersion } : {}),
    ...createV1Adapter(
      {
        client: input.client,
        directory: input.directory,
        worktree: input.worktree,
      },
      logger,
    ),
    ...(writeAudit === undefined ? {} : { writeAudit }),
  };
  // Ask-decision capture runs only when enabled; the registry is the sole
  // consumer of question events and never affects permission handling.
  const askDecisions = config.askDecisions
    ? new AskDecisionRegistry(logger)
    : undefined;
  const runtime = new ApprovalReviewerRuntime(
    ctx,
    config,
    logger,
    undefined,
    askDecisions,
  );
  return {
    event: async ({ event }: HookEvent): Promise<void> => {
      // Observe synchronously first: reviews started by later events must see
      // ask decisions captured by this one. The observer is total.
      askDecisions?.observe(event);
      runtime.handlePermissionReply(event);
      const request = extractPermissionRequest(event);
      if (!request) return;
      runtime.handle(request);
    },
    // Approvals no longer annotate tool results. `annotateToolResult` remains
    // exported as a deprecated no-op for external callers; the host hook is
    // omitted so it is not invoked after every tool execution for no effect.
    dispose: async () => {
      await runtime.dispose();
    },
  };
};

const module: { id: string; server: Plugin; setup: typeof setup } = {
  id: "opencode-permission-reviewer",
  server,
  setup,
};

export default module;
// biome-ignore lint/performance/noBarrelFile: package entry for "." and "./server" (dist/index.js); the re-exports are the public API
export { extractPermissionRequest } from "./adapters/opencode/event-normalizer.ts";
export { emergencyBrakeReason } from "./modules/analysis/brake/emergency-brake.ts";
export type * from "./modules/analysis/capability/models/capability-types.ts";
export type * from "./modules/audit/models/audit-record.ts";
export {
  createAuditWriter,
  DEFAULT_AUDIT_PATH,
} from "./modules/audit/services/audit.ts";
export { resolveConfig } from "./modules/config/services/config.ts";
export { loadResolvedConfig } from "./modules/config/services/loader.ts";
export type * from "./modules/context/models/actor-context-types.ts";
export {
  AskDecisionRegistry,
  DISMISSED_ANSWER,
} from "./modules/context/services/ask-decisions.ts";
export { enrichGitEvidence } from "./modules/evidence/git/git-evidence.ts";
export { enrichLocalScriptEvidence } from "./modules/evidence/local-script/local-script-evidence.ts";
export { enrichSshEvidence } from "./modules/evidence/ssh/ssh-evidence.ts";
export { parseDecision } from "./modules/review/services/decision/decision.ts";
export { enforceDecision } from "./modules/review/services/decision/decision-gates.ts";
export { DECISION_SCHEMA } from "./modules/review/services/decision/decision-schema.ts";
export {
  applyEscalationDisposition,
  resolveEscalationDisposition,
} from "./modules/review/services/decision/escalation.ts";
export { ReviewCoordinator as ApprovalReviewerRuntime } from "./modules/review/services/review-coordinator.ts";
export type * from "./modules/reviewer/models/system-one-types.ts";
export {
  createUiStatus,
  decodeUiStatus,
  encodeUiStatus,
  permissionAction,
} from "./modules/status/models/ui-protocol.ts";
export { ReviewUiState } from "./modules/status/services/ui-state.ts";
export type * from "./types.ts";
export { redactSecrets } from "./utils/redact.ts";
