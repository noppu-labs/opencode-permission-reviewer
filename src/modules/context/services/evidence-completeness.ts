// Whether the reviewer saw the action in full, and why the evidence falls short: purpose, the pending section, the verified script.

import type { ActionPurpose } from "../../../kernel/actor-context-types.ts";
import type { PermissionRequest } from "../../../kernel/permission-request.ts";
import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import type { VerifiedScriptEvidence } from "../../evidence/ssh/verified-ssh-script.ts";
import type { ActorResolution } from "../models/unknown-resolution.ts";
import { pendingPermissionSection } from "./pending-permission.ts";

interface ActionCompleteness {
  purposeOk: boolean;
  /** False also when the verified script could not stand in for its content. */
  actionEvidenceComplete: boolean;
  reasons: string[];
}

export function actionCompleteness(
  request: PermissionRequest,
  config: ReviewerConfig,
  actor: ActorResolution,
  actionPurpose: ActionPurpose,
  verifiedScript: VerifiedScriptEvidence | undefined,
): ActionCompleteness {
  const purposeOk = actionPurpose.source !== "unavailable";
  const reasons = [...actor.completeness.reasons];
  if (!purposeOk) reasons.push("action purpose unavailable");

  // Whether the action under review reached the rendered evidence in full
  // (no elided command middle, no truncated PENDING_PERMISSION section). The
  // engine's allow gate blocks automatic approval when this is false.
  const { actionEvidenceComplete } = pendingPermissionSection(request, config);
  if (!actionEvidenceComplete)
    reasons.push("pending action was elided or truncated in the evidence");
  const scriptUnavailable = verifiedScript?.status === "unavailable";
  if (scriptUnavailable)
    reasons.push(
      "verified script content was unavailable or did not match its hash",
    );
  return {
    purposeOk,
    actionEvidenceComplete: actionEvidenceComplete && !scriptUnavailable,
    reasons,
  };
}
