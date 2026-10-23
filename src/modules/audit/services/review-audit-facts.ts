// The audit record's snapshots of the attempt's evidence: timings, evidence
// completeness, the verified script, the actor, the capability flags that
// held, the policy trace and the latest ask decisions.

import type { ReviewAttempt } from "../../review/services/review-attempt.ts";
import type { ReviewAuditRecord } from "../models/audit-record.ts";

type Evidence = ReviewAttempt["evidence"];
type Capability = NonNullable<Evidence["capability"]>;

export function evidenceFields(
  evidence: Evidence,
): Pick<
  ReviewAuditRecord,
  "timings" | "evidenceCompleteness" | "verifiedScript"
> {
  const { timings, evidenceCompleteness, verifiedScript } = evidence;
  return {
    ...(timings === undefined ? {} : { timings }),
    ...(evidenceCompleteness === undefined
      ? {}
      : { evidenceCompleteness: evidenceCompleteness.overall }),
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
  };
}

export function actorFields(
  actor: Evidence["actor"],
): Pick<ReviewAuditRecord, "rootSessionID" | "actor"> {
  if (actor === undefined) return {};
  return {
    rootSessionID: actor.rootSessionID.value,
    actor: {
      ...(actor.agentName.value === undefined
        ? {}
        : { name: actor.agentName.value }),
      ...(actor.mode.value === undefined ? {} : { mode: actor.mode.value }),
      profile: actor.profile.value,
      identityCompleteness: actor.identityCompleteness,
      identitySource: actor.agentName.source,
      confidence: actor.agentName.confidence,
      delegationDepth: actor.delegationDepth.value,
    },
  };
}

/** The names, in record order, of the facts whose `true` value is recorded. */
function trueFacts<K extends string>(
  facts: ReadonlyArray<readonly [K, { value: unknown }]>,
): Partial<Record<K, true>> {
  const recorded: Partial<Record<K, true>> = {};
  for (const [name, fact] of facts)
    if (fact.value === true) recorded[name] = true;
  return recorded;
}

export function capabilityField(
  capability: Capability | undefined,
): Pick<ReviewAuditRecord, "capability"> {
  if (capability === undefined) return {};
  const writes = capability.writeEffects;
  return {
    capability: {
      actionClass: capability.actionClass.value,
      summary: capability.summary,
      parserCompleteness: capability.parserCompleteness,
      ...trueFacts([
        ["executesCode", capability.executesCode],
        ["createsAdHocCode", capability.createsAdHocCode],
        [
          "invokesPackageLifecycleScripts",
          capability.invokesPackageLifecycleScripts,
        ],
      ]),
      writeEffects: trueFacts([
        ["temporaryWrite", writes.temporaryWrite],
        ["workspaceWrite", writes.workspaceWrite],
        ["externalWrite", writes.externalWrite],
        ["deletion", writes.deletion],
      ]),
      ...trueFacts([
        ["networkObserved", capability.network.observed],
        ["credentialRead", capability.credentialRead],
        ["privilegeEscalation", capability.process.privilegeEscalation],
        ["persistence", capability.process.persistence],
        ["remoteEnabled", capability.remote.enabled],
        ["gitMutation", capability.git.possible],
      ]),
    },
  };
}

export function traceAndAskFields(
  evidence: Evidence,
): Pick<ReviewAuditRecord, "policyTrace" | "askDecisions"> {
  const { policyTrace, askDecisions } = evidence;
  return {
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
}
