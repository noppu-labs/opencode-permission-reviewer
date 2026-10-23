// The review audit record built from a finished attempt: the request's action
// hash and the record's field groups, in the record's key order.
import { createHash } from "node:crypto";
import packageInfo from "../../../../../package.json";
import type { PermissionRequest } from "../../../../kernel/permission-request.ts";
import type {
  DecisionSource,
  ReviewExecutionResult,
} from "../../../../kernel/review-result.ts";
import type { ReviewAuditRecord } from "../../../audit/models/audit-record.ts";
import { REVIEWER_PROMPT_VERSION } from "../../../context/services/prompt/policy.ts";
import { DECISION_SCHEMA_VERSION } from "../../../decision/decision.ts";
import { configFingerprint } from "../../../evidence/ssh/verified-ssh-script.ts";
import { type CoordinatorState, isSuperseded } from "../coordinator-state.ts";
import type { ReviewAttempt } from "../review-attempt.ts";
import {
  actorFields,
  capabilityField,
  evidenceFields,
  traceAndAskFields,
} from "./review-audit-facts.ts";
import {
  configWarningsField,
  escalationFields,
  outcomeFields,
} from "./review-audit-outcome.ts";

export type AuditRecordScope = Pick<
  CoordinatorState,
  "ctx" | "config" | "generation" | "stopped" | "resolvedManually"
>;

type Evidence = ReviewAttempt["evidence"];

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

export function buildReviewAuditRecord(
  scope: AuditRecordScope,
  attempt: ReviewAttempt,
  request: PermissionRequest,
  result: ReviewExecutionResult,
  startedAt: number,
): ReviewAuditRecord {
  const evidence = attempt.evidence;
  // Fallback for a result whose path set no `decisionSource`: one still
  // carrying a reviewer decision is an LLM outcome, anything else a fail-safe
  // escalation.
  const decisionSource: DecisionSource =
    result.decisionSource ??
    (result.decision === undefined ? "failure-safe" : "llm-reviewer");
  const warnings = auditWarnings(evidence);
  const effectiveConfigHash = configFingerprint(scope.config);
  const hash = actionHash(request);
  return {
    schemaVersion: 3,
    reviewID: attempt.id,
    hostRequestID: request.id,
    hostGeneration: "v1",
    hostVersion: scope.ctx.hostVersion ?? "unknown",
    generation: scope.generation,
    directory: scope.ctx.directory,
    nativeAction: request.permission,
    pluginVersion: packageInfo.version,
    effectiveConfigHash,
    ...configWarningsField(scope.config),
    actionFingerprint: `v1:${hash}`,
    application: isSuperseded(scope, request)
      ? "superseded"
      : attempt.application,
    decisionSchemaVersion: DECISION_SCHEMA_VERSION,
    promptVersion: REVIEWER_PROMPT_VERSION,
    decisionSource,
    actionHash: hash,
    reviewerModel: result.reviewerModel ?? scope.config.model,
    ...escalationFields(result),
    timestamp: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    requestID: request.id,
    sessionID: request.sessionID,
    permission: request.permission,
    outcome: result.kind,
    reason: result.reason,
    ...(warnings.length === 0 ? {} : { warnings }),
    ...evidenceFields(evidence),
    ...outcomeFields(result),
    ...actorFields(evidence.actor),
    ...(!evidence.sshAudit?.length ? {} : { ssh: evidence.sshAudit }),
    ...capabilityField(evidence.capability),
    ...traceAndAskFields(evidence),
  };
}

function auditWarnings(evidence: Evidence): string[] {
  const warnings: string[] = [];
  if (evidence.evidenceCompleteness !== undefined)
    warnings.push(...evidence.evidenceCompleteness.reasons);
  if (evidence.capability !== undefined)
    warnings.push(...evidence.capability.analysisWarnings);
  return warnings;
}
