// The V2 audit record's evidence groups, in record order: the policy trace,
// evidence completeness, ssh records, the verified script, the latest ask
// decisions and the actor.
import type { ReviewAuditRecord } from "../../../modules/audit/models/audit-record.ts";
import type { ReviewEnvelope } from "../../../modules/context/models/review-envelope.ts";

type Actor = NonNullable<ReviewEnvelope["actor"]>;
type VerifiedScript = NonNullable<ReviewEnvelope["verifiedScript"]>;
type AskDecisions = NonNullable<ReviewEnvelope["askDecisions"]>;

function verifiedScriptField(
  script: VerifiedScript | undefined,
): Pick<ReviewAuditRecord, "verifiedScript"> {
  if (!script) return {};
  return {
    verifiedScript: {
      sha256: script.sha256,
      status: script.status,
      ...(script.bytes === undefined ? {} : { bytes: script.bytes }),
    },
  };
}

function askDecisionsField(
  askDecisions: AskDecisions | undefined,
): Pick<ReviewAuditRecord, "askDecisions"> {
  if (!askDecisions) return {};
  return {
    askDecisions: askDecisions
      .slice(-5)
      .map(({ at, question, answer }) => ({ at, question, answer })),
  };
}

function actorFields(
  actor: Actor | undefined,
): Pick<ReviewAuditRecord, "rootSessionID" | "actor"> {
  if (!actor) return {};
  return {
    rootSessionID: actor.rootSessionID.value,
    actor: {
      ...(actor.agentName.value ? { name: actor.agentName.value } : {}),
      profile: actor.profile.value,
      identityCompleteness: actor.identityCompleteness,
      identitySource: actor.agentName.source,
      confidence: actor.agentName.confidence,
      delegationDepth: actor.delegationDepth.value,
    },
  };
}

export function evidenceFields(
  envelope: ReviewEnvelope | undefined,
): Pick<
  ReviewAuditRecord,
  | "policyTrace"
  | "evidenceCompleteness"
  | "warnings"
  | "ssh"
  | "verifiedScript"
  | "askDecisions"
  | "rootSessionID"
  | "actor"
> {
  return {
    ...(envelope?.policyTrace ? { policyTrace: envelope.policyTrace } : {}),
    ...(envelope?.evidenceCompleteness
      ? {
          evidenceCompleteness: envelope.evidenceCompleteness.overall,
          warnings: envelope.evidenceCompleteness.reasons,
        }
      : {}),
    ...(envelope?.sshAudit.length ? { ssh: envelope.sshAudit } : {}),
    ...verifiedScriptField(envelope?.verifiedScript),
    ...askDecisionsField(envelope?.askDecisions),
    ...actorFields(envelope?.actor),
  };
}
