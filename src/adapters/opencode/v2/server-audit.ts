// The V2 audit record of a finished review, in record key order.
import { createHash } from "node:crypto";
import type { PermissionEvaluation } from "@opencode/plugin/promise/permission";
import packageInfo from "../../../../package.json";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewAuditRecord } from "../../../modules/audit/models/audit-record.ts";
import { REVIEWER_PROMPT_VERSION } from "../../../modules/context/services/prompt/policy.ts";
import { configWarningsField } from "../../../modules/review/services/audit-record/review-audit-outcome.ts";
import { evidenceFields } from "./server-audit-evidence.ts";
import type { ReviewRun, ServerState } from "./server-state.ts";

export type AuditScope = Pick<
  ServerState,
  "ctx" | "config" | "generation" | "directory" | "effectiveConfigHash"
>;

function reviewerFields(
  result: ReviewExecutionResult,
): Pick<ReviewAuditRecord, "reviewerEscalatedFrom" | "systemOne"> {
  return {
    ...(result.reviewerEscalatedFrom
      ? { reviewerEscalatedFrom: result.reviewerEscalatedFrom }
      : {}),
    ...(result.systemOne ? { systemOne: result.systemOne } : {}),
  };
}

function fingerprintField(
  run: ReviewRun,
): Pick<ReviewAuditRecord, "actionFingerprint"> {
  if (!run.normalized) return {};
  return {
    actionFingerprint:
      "v2:" +
      createHash("sha256")
        .update(
          JSON.stringify({
            action: run.input.action,
            resources: run.normalized.request.patterns,
            metadata: run.normalized.request.metadata,
          }),
        )
        .digest("hex"),
  };
}

function decisionFields(
  result: ReviewExecutionResult,
): Pick<
  ReviewAuditRecord,
  | "reviewerOutcome"
  | "riskLevel"
  | "userAuthorization"
  | "scopeAlignment"
  | "confidence"
  | "escalationDisposition"
  | "resolution"
> {
  return {
    ...(result.decision
      ? {
          reviewerOutcome: result.decision.outcome,
          riskLevel: result.decision.risk_level,
          userAuthorization: result.decision.user_authorization,
          scopeAlignment: result.decision.scope_alignment,
          confidence: result.decision.confidence,
        }
      : {}),
    ...(result.escalationDisposition
      ? { escalationDisposition: result.escalationDisposition }
      : {}),
    ...(result.resolution ? { resolution: result.resolution } : {}),
  };
}

function application(
  active: boolean,
  effect: PermissionEvaluation["effect"],
): NonNullable<ReviewAuditRecord["application"]> {
  if (!active) return "cancelled";
  return effect === "ask" ? "human-pending" : "evaluation-returned";
}

export function reviewAuditRecord(
  scope: AuditScope,
  run: ReviewRun,
  result: ReviewExecutionResult,
  active: boolean,
): ReviewAuditRecord {
  const { input, attempt, normalized, envelope } = run;
  return {
    schemaVersion: 3,
    decisionSchemaVersion: 2,
    pluginVersion: packageInfo.version,
    promptVersion: REVIEWER_PROMPT_VERSION,
    reviewerModel: result.reviewerModel ?? scope.config.model,
    ...reviewerFields(result),
    effectiveConfigHash: scope.effectiveConfigHash,
    ...configWarningsField(scope.config),
    ...fingerprintField(run),
    reviewID: attempt.id,
    requestID: attempt.id,
    hostGeneration: "v2",
    hostVersion: scope.ctx.app.version,
    generation: scope.generation,
    directory: scope.directory,
    nativeAction: input.action,
    sessionID: input.sessionID,
    permission: normalized?.request.permission ?? input.action,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - attempt.startedAt,
    outcome: result.kind,
    reason: result.reason,
    decisionSource: result.decisionSource ?? "failure-safe",
    ...decisionFields(result),
    ...evidenceFields(envelope),
    application: application(active, input.effect),
    ...(result.reviewSessionID
      ? { reviewerSessionID: result.reviewSessionID }
      : {}),
    ...(envelope?.timings ? { timings: envelope.timings } : {}),
  };
}
