// The audit record's fields taken from the review result: the escalation
// hand-off, System One's scores, the reviewer outcome and decision, and the
// reviewer session; and the resolved config's warnings.
import type { ReviewAuditRecord } from "../audit-record.ts";
import type { ReviewExecutionResult, ReviewerConfig } from "../types.ts";

export function escalationFields(
  result: ReviewExecutionResult,
): Pick<ReviewAuditRecord, "reviewerEscalatedFrom" | "systemOne"> {
  return {
    ...(result.reviewerEscalatedFrom === undefined
      ? {}
      : { reviewerEscalatedFrom: result.reviewerEscalatedFrom }),
    ...(result.systemOne === undefined ? {} : { systemOne: result.systemOne }),
  };
}

export function outcomeFields(
  result: ReviewExecutionResult,
): Pick<
  ReviewAuditRecord,
  | "reviewerOutcome"
  | "escalationDisposition"
  | "resolution"
  | "riskLevel"
  | "userAuthorization"
  | "scopeAlignment"
  | "confidence"
  | "reviewerSessionID"
> {
  const decision = result.decision;
  return {
    ...(result.reviewerOutcome === undefined
      ? {}
      : { reviewerOutcome: result.reviewerOutcome }),
    ...(result.escalationDisposition === undefined
      ? {}
      : { escalationDisposition: result.escalationDisposition }),
    ...(result.resolution === undefined
      ? {}
      : { resolution: result.resolution }),
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
  };
}

/** The resolved config's warnings, only when there are any. */
export function configWarningsField(
  config: Pick<ReviewerConfig, "configWarnings">,
): Pick<ReviewAuditRecord, "configWarnings"> {
  const warnings = config.configWarnings;
  return warnings === undefined || warnings.length === 0
    ? {}
    : { configWarnings: warnings };
}
