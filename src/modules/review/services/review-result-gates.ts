// The gates that run on the reviewer's result: the allow gate (degraded
// config, incomplete action evidence), the escalation disposition, and the
// remote-script guidance.

import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewExecutionResult } from "../../../kernel/review-result.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { ReviewEnvelope } from "../../context/models/review-envelope.ts";
import { sourceCommand } from "../../evidence/providers/source-command.ts";
import { applyEscalationDisposition } from "./decision/escalation.ts";

export function gateReviewedResult(
  request: PermissionRequest,
  config: ReviewerConfig,
  envelope: ReviewEnvelope,
  reviewed: ReviewExecutionResult,
): ReviewExecutionResult {
  const result =
    reviewed.kind === "allow"
      ? gateAllow(reviewed, config, envelope)
      : reviewed;
  const disposed =
    result.kind === "escalate" && result.escalationDisposition === undefined
      ? applyEscalationDisposition(result, config, "general")
      : result;
  // Evaluated for every kind, allow included, so the envelope reads do not
  // depend on the outcome.
  const guidance = needsScriptGuidance(request, envelope, disposed);
  if (disposed.kind === "allow" || !guidance) return disposed;
  return {
    ...disposed,
    reason: `${disposed.reason} To inspect this script, stage its exact bytes locally and generate a hash-checked SSH command with opencode-permission-reviewer script command --file PATH --host HOST.`,
  };
}

function allowBlockedReason(
  config: ReviewerConfig,
  envelope: ReviewEnvelope,
): string | undefined {
  const degraded = config.configDegraded;
  if (degraded !== undefined && degraded.length > 0)
    return `Automatic approval is disabled: the reviewer configuration is degraded (${degraded.join("; ")}). Fix the trusted config to restore auto-approval.`;
  if (envelope.actionEvidenceComplete === false)
    return "Automatic approval is blocked: a material part of the pending action was elided or truncated in the reviewer evidence, so the model judged an incomplete view of the action.";
  return undefined;
}

function gateAllow(
  result: ReviewExecutionResult,
  config: ReviewerConfig,
  envelope: ReviewEnvelope,
): ReviewExecutionResult {
  const reason = allowBlockedReason(config, envelope);
  if (reason === undefined) return result;
  return applyEscalationDisposition(
    {
      kind: "escalate",
      reason,
      ...(result.decision === undefined ? {} : { decision: result.decision }),
      ...(result.reviewSessionID === undefined
        ? {}
        : { reviewSessionID: result.reviewSessionID }),
      ...(result.reviewerModel === undefined
        ? {}
        : { reviewerModel: result.reviewerModel }),
      ...(result.reviewerEscalatedFrom === undefined
        ? {}
        : { reviewerEscalatedFrom: result.reviewerEscalatedFrom }),
      ...(result.systemOne === undefined
        ? {}
        : { systemOne: result.systemOne }),
      decisionSource: "deterministic-policy",
    },
    config,
    "general",
  );
}

/** Whether a non-allow ssh result should tell the agent how to stage a
 *  hash-checked script, because the remote script could not be inspected. */
function needsScriptGuidance(
  request: PermissionRequest,
  envelope: ReviewEnvelope,
  disposed: ReviewExecutionResult,
): boolean {
  return (
    request.permission === "bash" &&
    /\bssh\b/.test(sourceCommand(request)) &&
    (envelope.verifiedScript?.status === "unavailable" ||
      envelope.sshAudit.some((entry) =>
        ["truncated", "unavailable", "blocked", "unresolved"].includes(
          entry.stdinStatus ?? "",
        ),
      ) ||
      /(?:(?:script|guion).{0,120}(?:truncat|truncad|unavailable|incomplet|not inspect|no.{0,20}inspeccion)|(?:truncat|truncad|incomplet).{0,120}(?:script|guion))/i.test(
        disposed.reason,
      ))
  );
}
