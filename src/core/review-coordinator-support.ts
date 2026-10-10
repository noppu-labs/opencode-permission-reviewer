// Review audit writing for the coordinator: the audit record builder, its action hash, the shared logger shape and the attempt-registration invariant message.
import { createHash } from "node:crypto";
import packageInfo from "../../package.json";
import type { DecisionSource, ReviewAuditRecord } from "../audit-record.ts";
import { DECISION_SCHEMA_VERSION } from "../decision.ts";
import { invariant } from "../invariant.ts";
import type { RuntimeContext } from "../opencode/types.ts";
import { REVIEWER_PROMPT_VERSION } from "../policy.ts";
import type {
  PermissionRequest,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../types.ts";
import type { ReviewAttempt } from "./review-attempt.ts";

export type Logger = (message: string, details?: unknown) => void;

/** Stable hash of the canonical request so audit records for the same action
 *  correlate across runs. Patterns are sorted so event order does not matter.
 *  The per-invocation tool call/message IDs are deliberately excluded: two
 *  identical commands in different sessions or runs must produce the same hash. */
function actionHash(request: PermissionRequest): string {
  const canonical = JSON.stringify({
    permission: request.permission,
    patterns: [...request.patterns].sort(), // NOSONAR(S2871) code-unit order is the canonical form of the audit action hash; a locale-aware compare would change hashes across locales and versions
    metadata: request.metadata,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** `ReviewCoordinator.process()` registers the attempt before its first await
 *  and deletes it only in its finally block, after closing it; `handle()`
 *  runs one `process()` per request ID. Every lookup asserted with this
 *  message runs inside that window. */
export const ATTEMPT_REGISTERED =
  "process() keeps the review attempt registered until it returns";

interface ReviewAuditScope {
  ctx: RuntimeContext;
  config: ReviewerConfig;
  generation: string;
  attempts: Map<string, ReviewAttempt>;
  isSuperseded: (request: PermissionRequest) => boolean;
  log: Logger;
}

export async function writeReviewAudit(
  scope: ReviewAuditScope,
  request: PermissionRequest,
  result: ReviewExecutionResult,
  startedAt: number,
): Promise<void> {
  if (!scope.ctx.writeAudit) return;
  const decision = result.decision;
  const attempt = scope.attempts.get(request.id);
  invariant(attempt, ATTEMPT_REGISTERED);
  const ssh = attempt.evidence.sshAudit;
  const actor = attempt.evidence.actor;
  const capability = attempt.evidence.capability;
  const policyTrace = attempt.evidence.policyTrace;
  const timings = attempt.evidence.timings;
  const evidence = attempt.evidence.evidenceCompleteness;
  const verifiedScript = attempt.evidence.verifiedScript;
  const askDecisions = attempt.evidence.askDecisions;
  // Fallback for a result whose path set no `decisionSource`: one still
  // carrying a reviewer decision is an LLM outcome, anything else a fail-safe
  // escalation.
  const decisionSource: DecisionSource =
    result.decisionSource ??
    (decision === undefined ? "failure-safe" : "llm-reviewer");
  const warnings: string[] = [];
  if (evidence !== undefined) warnings.push(...evidence.reasons);
  if (capability !== undefined) warnings.push(...capability.analysisWarnings);
  const record: ReviewAuditRecord = {
    schemaVersion: 3,
    reviewID: attempt.id,
    hostRequestID: request.id,
    hostGeneration: "v1",
    hostVersion: scope.ctx.hostVersion ?? "unknown",
    generation: scope.generation,
    directory: scope.ctx.directory,
    nativeAction: request.permission,
    pluginVersion: packageInfo.version,
    effectiveConfigHash: createHash("sha256")
      .update(JSON.stringify(scope.config))
      .digest("hex"),
    actionFingerprint: `v1:${actionHash(request)}`,
    application: scope.isSuperseded(request)
      ? "superseded"
      : attempt.application,
    decisionSchemaVersion: DECISION_SCHEMA_VERSION,
    promptVersion: REVIEWER_PROMPT_VERSION,
    decisionSource,
    actionHash: actionHash(request),
    reviewerModel: result.reviewerModel ?? scope.config.model,
    ...(result.reviewerEscalatedFrom === undefined
      ? {}
      : { reviewerEscalatedFrom: result.reviewerEscalatedFrom }),
    ...(result.systemOne === undefined ? {} : { systemOne: result.systemOne }),
    timestamp: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    requestID: request.id,
    sessionID: request.sessionID,
    permission: request.permission,
    outcome: result.kind,
    reason: result.reason,
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(timings === undefined ? {} : { timings }),
    ...(evidence === undefined
      ? {}
      : { evidenceCompleteness: evidence.overall }),
    ...(verifiedScript === undefined
      ? {}
      : {
          verifiedScript: {
            sha256: verifiedScript.sha256,
            status: verifiedScript.status,
            ...(verifiedScript.bytes === undefined
              ? {}
              : { bytes: verifiedScript.bytes }),
          },
        }),
    ...(result.reviewerOutcome === undefined
      ? {}
      : { reviewerOutcome: result.reviewerOutcome }),
    ...(result.escalationDisposition === undefined
      ? {}
      : { escalationDisposition: result.escalationDisposition }),
    ...(decision === undefined
      ? {}
      : {
          riskLevel: decision.risk_level,
          userAuthorization: decision.user_authorization,
          scopeAlignment: decision.scope_alignment,
          confidence: decision.confidence,
        }),
    ...(result.reviewSessionID === undefined
      ? {}
      : { reviewerSessionID: result.reviewSessionID }),
    ...(actor === undefined
      ? {}
      : {
          rootSessionID: actor.rootSessionID.value,
          actor: {
            ...(actor.agentName.value === undefined
              ? {}
              : { name: actor.agentName.value }),
            ...(actor.mode.value === undefined
              ? {}
              : { mode: actor.mode.value }),
            profile: actor.profile.value,
            identityCompleteness: actor.identityCompleteness,
            identitySource: actor.agentName.source,
            confidence: actor.agentName.confidence,
            delegationDepth: actor.delegationDepth.value,
          },
        }),
    ...(!ssh?.length ? {} : { ssh }),
    ...(capability === undefined
      ? {}
      : {
          capability: {
            actionClass: capability.actionClass.value,
            summary: capability.summary,
            parserCompleteness: capability.parserCompleteness,
            ...(capability.executesCode.value === true
              ? { executesCode: true }
              : {}),
            ...(capability.createsAdHocCode.value === true
              ? { createsAdHocCode: true }
              : {}),
            ...(capability.invokesPackageLifecycleScripts.value === true
              ? { invokesPackageLifecycleScripts: true }
              : {}),
            writeEffects: {
              ...(capability.writeEffects.temporaryWrite.value === true
                ? { temporaryWrite: true }
                : {}),
              ...(capability.writeEffects.workspaceWrite.value === true
                ? { workspaceWrite: true }
                : {}),
              ...(capability.writeEffects.externalWrite.value === true
                ? { externalWrite: true }
                : {}),
              ...(capability.writeEffects.deletion.value === true
                ? { deletion: true }
                : {}),
            },
            ...(capability.network.observed.value === true
              ? { networkObserved: true }
              : {}),
            ...(capability.credentialRead.value === true
              ? { credentialRead: true }
              : {}),
            ...(capability.process.privilegeEscalation.value === true
              ? { privilegeEscalation: true }
              : {}),
            ...(capability.process.persistence.value === true
              ? { persistence: true }
              : {}),
            ...(capability.remote.enabled.value === true
              ? { remoteEnabled: true }
              : {}),
            ...(capability.git.possible.value === true
              ? { gitMutation: true }
              : {}),
          },
        }),
    ...(policyTrace === undefined
      ? {}
      : {
          policyTrace: {
            effectivePolicyHash: policyTrace.effectivePolicyHash,
            matchedRules: policyTrace.matchedRules,
            finalRoute: policyTrace.finalRoute,
            mode: policyTrace.mode,
          },
        }),
    ...(askDecisions === undefined
      ? {}
      : {
          askDecisions: askDecisions.slice(-5).map((d) => ({
            at: d.at,
            question: d.question,
            answer: d.answer,
          })),
        }),
  };
  await scope.ctx.writeAudit(record).catch((error) => {
    scope.log("failed to write review audit", {
      requestID: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
