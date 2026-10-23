// Fixtures for the policy-engine characterisation suites: a capability whose
// condition-backing facts are set per flag, an actor, and a route helper.

import type { CapabilityAssessment } from "../src/modules/analysis/capability/models/capability-types.ts";
import { DEFAULT_CONFIG } from "../src/modules/config/services/config.ts";
import type {
  ActorContext,
  Provenanced,
} from "../src/modules/context/models/actor-context-types.ts";
import { evaluatePolicy } from "../src/modules/policy/policy-engine.ts";
import type {
  ActorProfile,
  CapabilityActionClass,
  PolicyCondition,
  PolicyRule,
  RepositoryTrust,
  ReviewerConfig,
} from "../src/types.ts";

export type Flag = Exclude<
  keyof PolicyCondition,
  "always" | "actionClass" | "actorProfile" | "repositoryTrust"
>;
export type FactValue = boolean | "unknown";

export const FLAGS: readonly Flag[] = [
  "writesWorkspace",
  "writesExternal",
  "writesTemporary",
  "deletion",
  "executesCode",
  "createsAdHocCode",
  "packageManagement",
  "gitMutation",
  "networkObserved",
  "credentialRead",
  "privilegeEscalation",
  "remoteEnabled",
  "persistence",
];

function fact<T>(value: T): Provenanced<T> {
  return { value, source: "static-analysis", confidence: "high" };
}

/** A capability whose condition-backing facts come from `facts` (default
 *  "unknown") and whose other facts stay "unknown". */
export function capability(
  facts: Partial<Record<Flag, FactValue>> = {},
  actionClass: CapabilityActionClass = "read-only",
): CapabilityAssessment {
  const f = (flag: Flag): Provenanced<FactValue> =>
    fact(facts[flag] ?? "unknown");
  const unknown = fact<FactValue>("unknown");
  return {
    actionClass: fact(actionClass),
    summary: actionClass,
    executesCode: f("executesCode"),
    executesRepositoryCode: unknown,
    createsAdHocCode: f("createsAdHocCode"),
    invokesExistingTestRunner: unknown,
    invokesPackageLifecycleScripts: f("packageManagement"),
    credentialRead: f("credentialRead"),
    writeEffects: {
      temporaryWrite: f("writesTemporary"),
      workspaceWrite: f("writesWorkspace"),
      externalWrite: f("writesExternal"),
      deletion: f("deletion"),
    },
    network: {
      observed: f("networkObserved"),
      possible: unknown,
      destinations: [],
      observedAccess: unknown,
      possibleAccess: unknown,
    },
    process: {
      childProcesses: unknown,
      persistence: f("persistence"),
      privilegeEscalation: f("privilegeEscalation"),
    },
    remote: { enabled: f("remoteEnabled"), mutationHint: unknown },
    git: {
      observed: unknown,
      possible: f("gitMutation"),
      observedAccess: unknown,
      possibleAccess: unknown,
    },
    parserCompleteness: "complete-for-supported-form",
    analysisWarnings: [],
  };
}

export function actor(profile: ActorProfile): ActorContext {
  return {
    agentName: fact("test"),
    mode: fact("build"),
    profile: fact(profile),
    sessionID: "ses_1",
    parentSessionID: fact(undefined),
    rootSessionID: fact("ses_1"),
    delegationDepth: fact(0),
    identityCompleteness: "complete",
  };
}

export function denyWhen(when: PolicyCondition | undefined): PolicyRule[] {
  const rule: PolicyRule = {
    id: "r",
    source: "global",
    effect: "deny",
    reason: "r",
  };
  return [when === undefined ? rule : { ...rule, when }];
}

/** Rules read from JSON, the way config layers arrive, so a condition can
 *  carry a shape the static types exclude. */
export function parsedRules(json: string): PolicyRule[] {
  return JSON.parse(json);
}

/** No defaults for `cap` and `who`: an explicit `undefined` must reach the
 *  engine rather than select a default. */
export function routeFor(
  rules: PolicyRule[],
  cap: CapabilityAssessment | undefined,
  who: ActorContext | undefined,
  config: ReviewerConfig = DEFAULT_CONFIG,
): string {
  return evaluatePolicy(cap, who, config, rules).finalRoute;
}

export const withTrust = (
  repositoryTrust: RepositoryTrust,
): ReviewerConfig => ({
  ...DEFAULT_CONFIG,
  repositoryTrust,
});

export const someone = actor("workspace");

export const allTrue = (except: Flag): Partial<Record<Flag, FactValue>> =>
  Object.fromEntries(FLAGS.filter((f) => f !== except).map((f) => [f, true]));
