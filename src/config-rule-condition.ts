import type {
  ActorProfile,
  CapabilityActionClass,
  PolicyCondition,
} from "./types.ts";

export const ACTOR_PROFILES: ReadonlySet<ActorProfile> = new Set([
  "read-only",
  "validation",
  "workspace",
  "operator",
  "reviewer",
  "unknown",
]);

/** Every action class the capability analyzer can produce. The `Record`
 *  annotation keeps this list in sync with the union type: adding a member to
 *  `CapabilityActionClass` without listing it here is a compile error. */
const ACTION_CLASS_MEMBERS: Record<CapabilityActionClass, true> = {
  "read-only": true,
  "workspace-write": true,
  "temporary-write": true,
  "external-write": true,
  destruction: true,
  "code-execution": true,
  "package-management": true,
  "git-mutation": true,
  network: true,
  "remote-operation": true,
  "service-management": true,
  persistence: true,
  "privilege-escalation": true,
  unknown: true,
};

/** List conditions and the closed set each member must belong to, in the
 *  order they are copied into the validated condition. */
const CONDITION_LISTS: ReadonlyArray<
  readonly [key: string, valid: ReadonlySet<string>]
> = [
  ["actionClass", new Set(Object.keys(ACTION_CLASS_MEMBERS))],
  ["actorProfile", ACTOR_PROFILES],
  ["repositoryTrust", new Set(["trusted", "untrusted", "unknown"])],
];

/** The boolean conditions, each backed by one capability fact. */
export type ConditionFlag = Exclude<
  keyof PolicyCondition,
  "always" | "actionClass" | "actorProfile" | "repositoryTrust"
>;

/** Every flag condition, in the order flags are validated and evaluated. As
 *  with `ACTION_CLASS_MEMBERS`, the `Record` annotation makes a flag missing
 *  from this list a compile error. */
const CONDITION_FLAG_MEMBERS: Record<ConditionFlag, true> = {
  writesWorkspace: true,
  writesExternal: true,
  writesTemporary: true,
  deletion: true,
  executesCode: true,
  createsAdHocCode: true,
  packageManagement: true,
  gitMutation: true,
  networkObserved: true,
  credentialRead: true,
  privilegeEscalation: true,
  remoteEnabled: true,
  persistence: true,
};

export const CONDITION_FLAG_KEYS = Object.keys(
  CONDITION_FLAG_MEMBERS,
) as readonly ConditionFlag[];

const KNOWN_CONDITION_KEYS: ReadonlySet<string> = new Set([
  "always",
  ...CONDITION_LISTS.map(([key]) => key),
  ...CONDITION_FLAG_KEYS,
]);

/** Validate a policy condition's sub-fields; return null if malformed (so a bad
 *  rule is dropped rather than crashing the engine at match time). */
export function validateCondition(
  value: Record<string, unknown>,
): PolicyCondition | null {
  // An unknown key (usually a typo) must drop the rule: silently discarding it
  // could strip the rule's only condition and turn a narrow rule into a
  // universal match.
  if (Object.keys(value).some((key) => !KNOWN_CONDITION_KEYS.has(key)))
    return null;
  // `always` is the explicit catch-all spelling; it makes sense only alone.
  if (value.always !== undefined) {
    if (value.always !== true || Object.keys(value).length !== 1) return null;
    return { always: true };
  }
  const out: Record<string, unknown> = {};
  if (!copyListConditions(value, out) || !copyFlagConditions(value, out))
    return null;
  // A condition that validated to nothing would match every request while
  // LOOKING conditioned; catch-alls must be spelled unambiguously (omit `when`
  // entirely, or `{ always: true }`).
  if (Object.keys(out).length === 0) return null;
  return out as PolicyCondition;
}

/** List conditions are matched with `includes()` at match time, so a member
 *  outside the closed set (usually a typo) would never match and would
 *  silently disable the rule. Rejecting it drops the rule through the normal
 *  path, which degrades trusted configs fail-closed instead of losing a
 *  restriction quietly. Empty lists never match either, so they are rejected
 *  for the same reason. */
function copyListConditions(
  value: Record<string, unknown>,
  out: Record<string, unknown>,
): boolean {
  for (const [key, valid] of CONDITION_LISTS) {
    if (value[key] === undefined) continue;
    if (!isClosedSetMemberArray(value[key], valid)) return false;
    out[key] = value[key];
  }
  return true;
}

function copyFlagConditions(
  value: Record<string, unknown>,
  out: Record<string, unknown>,
): boolean {
  for (const flag of CONDITION_FLAG_KEYS) {
    if (value[flag] === undefined) continue;
    if (typeof value[flag] !== "boolean") return false;
    // Capability facts are `true | "unknown"` — never false — so a `false`
    // condition could never match. Reject it instead of ignoring the filter:
    // an ignored condition widens the rule.
    if (value[flag] === false) return false;
    out[flag] = value[flag];
  }
  return true;
}

/** A non-empty string array whose members all belong to the closed set. */
function isClosedSetMemberArray(
  value: unknown,
  valid: ReadonlySet<string>,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string" && valid.has(v))
  );
}
