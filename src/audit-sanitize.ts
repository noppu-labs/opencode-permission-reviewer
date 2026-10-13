// The audit writer's sanitiser: bounds and redacts the free-text fields of a
// record and leaves its structural identifiers intact.
import type { ReviewAuditRecord } from "./audit-record.ts";
import { redactSecrets } from "./redact.ts";

function boundedReason(reason: string): string {
  const normalized = reason.replace(/[\r\n]+/g, " ").trim();
  return normalized.length <= 2_000
    ? normalized
    : `${normalized.slice(0, 2_000)}…`;
}

function boundedModelID(model: string): string {
  return model.length <= 128 ? model : `${model.slice(0, 128)}…`;
}

type Sanitized<K extends keyof ReviewAuditRecord> = Partial<
  Pick<ReviewAuditRecord, K>
>;

function sanitizedPolicyTrace(
  record: ReviewAuditRecord,
): Sanitized<"policyTrace"> {
  if (record.policyTrace === undefined) return {};
  return {
    policyTrace: {
      ...record.policyTrace,
      // Rule reasons are admin-authored prose; redact them like any
      // other free text without touching the structural fields.
      matchedRules: record.policyTrace.matchedRules.map((match) => ({
        ...match,
        reason: redactSecrets(match.reason),
      })),
    },
  };
}

function sanitizedAskDecisions(
  record: ReviewAuditRecord,
): Sanitized<"askDecisions"> {
  if (record.askDecisions === undefined) return {};
  return {
    askDecisions: record.askDecisions.map((decision) => ({
      ...decision,
      question: redactSecrets(decision.question),
      answer: redactSecrets(decision.answer),
    })),
  };
}

function sanitizedEscalatedFrom(
  record: ReviewAuditRecord,
): Sanitized<"reviewerEscalatedFrom"> {
  if (record.reviewerEscalatedFrom === undefined) return {};
  return {
    reviewerEscalatedFrom: {
      ...record.reviewerEscalatedFrom,
      reason: redactSecrets(boundedReason(record.reviewerEscalatedFrom.reason)),
    },
  };
}

// The model ID is the one provider-controlled string in systemOne.
function sanitizedSystemOne(record: ReviewAuditRecord): Sanitized<"systemOne"> {
  if (record.systemOne === undefined) return {};
  return {
    systemOne: {
      ...record.systemOne,
      returnedModel: boundedModelID(
        redactSecrets(record.systemOne.returnedModel),
      ),
    },
  };
}

// Warnings can quote a raw config value, so they are bounded and redacted.
function sanitizedConfigWarnings(
  record: ReviewAuditRecord,
): Sanitized<"configWarnings"> {
  if (record.configWarnings === undefined) return {};
  return {
    configWarnings: record.configWarnings.map((warning) =>
      redactSecrets(boundedReason(warning)),
    ),
  };
}

/** Redact the free-text fields (the reason carries transport error messages
 *  and provider responses that never passed through the evidence pipeline's
 *  redaction). Structural identifiers are left intact: running the redactor
 *  over the whole serialized line would also match key names like
 *  "sessionID" and corrupt the record's correlation fields. */
export function sanitizeAuditRecord(
  record: ReviewAuditRecord,
): ReviewAuditRecord {
  return {
    ...record,
    reason: redactSecrets(boundedReason(record.reason)),
    ...(record.warnings === undefined
      ? {}
      : {
          warnings: record.warnings.map((warning) => redactSecrets(warning)),
        }),
    ...sanitizedPolicyTrace(record),
    ...sanitizedAskDecisions(record),
    ...sanitizedEscalatedFrom(record),
    ...sanitizedSystemOne(record),
    ...sanitizedConfigWarnings(record),
  };
}
