import type {
  ActorProfile,
  CapabilityActionClass,
  PolicyCondition,
  RepositoryTrust,
  ReviewerConfig,
} from "../../types.ts";
import type { CapabilityAssessment } from "../analysis/capability/models/capability-types.ts";
import {
  CONDITION_FLAG_KEYS,
  type ConditionFlag,
} from "../config/models/config-rule-condition.ts";
import type { ActorContext } from "../context/models/actor-context-types.ts";

// Condition matching for the declarative policy engine: one check per
// condition kind (enum lists, capability flags), evaluated in a fixed order.

/** Whether every field of a condition matches the observed facts. A missing
 *  condition (or `{ always: true }`) is a universal rule: it matches any
 *  request, which is why `validateCondition` rejects a condition that
 *  validates to nothing. */
export function conditionMatches(
  cond: PolicyCondition | undefined,
  cap: CapabilityAssessment | undefined,
  actor: ActorContext | undefined,
  config: ReviewerConfig,
): boolean {
  if (cond === undefined || cond.always === true) return true;
  return (
    listConditionHolds(cond.actionClass, cap, actionClassOf) &&
    listConditionHolds(cond.actorProfile, actor, profileOf) &&
    capabilityFlagsHold(cond, cap) &&
    listConditionHolds(cond.repositoryTrust, config, repositoryTrustOf)
  );
}

const actionClassOf = (cap: CapabilityAssessment): CapabilityActionClass =>
  cap.actionClass.value;
const profileOf = (actor: ActorContext): ActorProfile => actor.profile.value;
const repositoryTrustOf = (config: ReviewerConfig): RepositoryTrust =>
  config.repositoryTrust;

/** An enum-list condition holds when it is absent or lists the observed value.
 *  A non-array list or a missing subject never matches. */
function listConditionHolds<S, V>(
  list: readonly V[] | undefined,
  subject: S | undefined,
  observed: (subject: S) => V,
): boolean {
  if (list === undefined) return true;
  if (!Array.isArray(list) || subject === undefined) return false;
  return list.includes(observed(subject));
}

type MaybeCapability = CapabilityAssessment | undefined;
type MaybeFact = boolean | "unknown" | undefined;

/** The capability fact each boolean condition requires; the `Record`
 *  annotation makes a flag without a fact a compile error. */
const CAPABILITY_FLAG_FACTS: Readonly<
  Record<ConditionFlag, (cap: MaybeCapability) => MaybeFact>
> = {
  writesWorkspace: (cap: MaybeCapability): MaybeFact =>
    cap?.writeEffects.workspaceWrite.value,
  writesExternal: (cap: MaybeCapability): MaybeFact =>
    cap?.writeEffects.externalWrite.value,
  writesTemporary: (cap: MaybeCapability): MaybeFact =>
    cap?.writeEffects.temporaryWrite.value,
  deletion: (cap: MaybeCapability): MaybeFact =>
    cap?.writeEffects.deletion.value,
  executesCode: (cap: MaybeCapability): MaybeFact => cap?.executesCode.value,
  createsAdHocCode: (cap: MaybeCapability): MaybeFact =>
    cap?.createsAdHocCode.value,
  // Capability facts, not the dominant action class, decide package-management
  // matches: a command can execute code AND drive a package lifecycle at once
  // (e.g. `bun install`), and requiring the single dominant class to be
  // "package-management" would make the condition unmatchable for exactly the
  // most dangerous variants.
  packageManagement: (cap: MaybeCapability): MaybeFact =>
    cap?.invokesPackageLifecycleScripts.value,
  gitMutation: (cap: MaybeCapability): MaybeFact => cap?.git.possible.value,
  networkObserved: (cap: MaybeCapability): MaybeFact =>
    cap?.network.observed.value,
  credentialRead: (cap: MaybeCapability): MaybeFact =>
    cap?.credentialRead.value,
  privilegeEscalation: (cap: MaybeCapability): MaybeFact =>
    cap?.process.privilegeEscalation.value,
  remoteEnabled: (cap: MaybeCapability): MaybeFact => cap?.remote.enabled.value,
  persistence: (cap: MaybeCapability): MaybeFact =>
    cap?.process.persistence.value,
};

/** A flag set to `true` requires its fact to be `true`; any other value leaves
 *  the rule unconstrained. Without a capability no set flag holds. */
function capabilityFlagsHold(
  cond: PolicyCondition,
  cap: MaybeCapability,
): boolean {
  return CONDITION_FLAG_KEYS.every(
    (flag) => cond[flag] !== true || CAPABILITY_FLAG_FACTS[flag](cap) === true,
  );
}
