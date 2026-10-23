import { createHash } from "node:crypto";
import type { PolicyRule, PolicyTrace, ReviewerConfig } from "../../types.ts";
import type { CapabilityAssessment } from "../analysis/capability/models/capability-types.ts";
import type { ActorContext } from "../context/models/actor-context-types.ts";
import { conditionMatches } from "./policy-conditions.ts";

/*
 * Declarative policy engine (Layer B).
 *
 * Evaluates capability + actor facts against a rule set and produces a
 * PolicyTrace. The engine is pure logic — it never calls the LLM, never modifies
 * the request, and never throws. Match semantics are MOST-RESTRICTIVE: when
 * multiple rules match, the most restrictive effect wins (deny > manual > review
 * > allow). This prevents rule ordering from becoming a silent attack surface.
 *
 * In observe mode the trace is computed and audited but the coordinator always
 * proceeds to the reviewer LLM. In enforce mode a manual/deny finalRoute skips
 * the LLM entirely. Universal invariants (the emergency brake) always run before
 * this engine and are never weakened by policy rules.
 *
 * Default rules ship EMPTY so observe mode produces zero behavior change. The
 * conservative profile templates exist as documentation and will be added as
 * built-in rules before enforce mode is publicly enabled.
 */

const EFFECT_SEVERITY: Record<PolicyRule["effect"], number> = {
  deny: 3,
  manual: 2,
  review: 1,
  allow: 0,
};

const EMPTY_TRACE_ROUTE = "review" as const;

/**
 * Evaluate the declarative policy against capability and actor facts.
 * Never throws — returns a trace with an empty matchedRules list on any failure.
 */
export function evaluatePolicy(
  capability: CapabilityAssessment | undefined,
  actor: ActorContext | undefined,
  config: ReviewerConfig,
  rules: PolicyRule[] = [],
): PolicyTrace {
  const effectiveRules = filterProjectAllowRules(rules);
  const effectivePolicyHash = hashEffectivePolicy(effectiveRules, config);
  const matched: PolicyTrace["matchedRules"] = [];

  for (const rule of effectiveRules) {
    if (conditionMatches(rule.when, capability, actor, config)) {
      matched.push({
        id: rule.id,
        source: rule.source,
        effect: rule.effect,
        reason: rule.reason,
      });
    }
  }

  return {
    effectivePolicyHash,
    matchedRules: matched,
    finalRoute: mostRestrictiveRoute(matched),
    mode: config.enforcementMode,
  };
}

/** Project-sourced allow rules are rejected: project config cannot relax safety. */
export function filterProjectAllowRules(rules: PolicyRule[]): PolicyRule[] {
  return rules.filter((r) => !(r.source === "project" && r.effect === "allow"));
}

/** Most-restrictive resolution: deny > manual > review > allow. Seed from the
 *  first match so a lone allow rule is not silently overridden by the review
 *  default. */
function mostRestrictiveRoute(
  matched: PolicyTrace["matchedRules"],
): PolicyTrace["finalRoute"] {
  const [first, ...rest] = matched;
  if (first === undefined) return EMPTY_TRACE_ROUTE;
  let bestEffect = first.effect as PolicyTrace["finalRoute"];
  let bestSev = EFFECT_SEVERITY[first.effect as PolicyRule["effect"]] ?? 1;
  for (const rule of rest) {
    const sev = EFFECT_SEVERITY[rule.effect as PolicyRule["effect"]] ?? 1;
    if (sev > bestSev) {
      bestEffect = rule.effect as PolicyTrace["finalRoute"];
      bestSev = sev;
    }
  }
  return bestEffect;
}

/** Hash of everything that deterministically shapes a policy outcome: the
 *  effective rules plus the decision-relevant config (confidence floor, risk
 *  matrix and failure knobs, repository trust, enforcement/escalation modes,
 *  config degradation). Two runs that would enforce different thresholds or
 *  failure dispositions must not share the same "effective policy" identity. */
export function hashEffectivePolicy(
  rules: PolicyRule[],
  config: ReviewerConfig,
): string {
  const rulesCanonical = rules
    .map((r) => `${r.id}:${r.effect}:${JSON.stringify(r.when ?? null)}`)
    .sort()
    .join("|");
  const decisionConfig = JSON.stringify({
    confidenceThreshold: config.confidenceThreshold,
    minimumConfidence: config.riskPolicy.minimumConfidence,
    riskPolicyAllow: config.riskPolicy.allow,
    onInvalidDecision: config.riskPolicy.onInvalidDecision,
    onReviewerFailure: config.riskPolicy.onReviewerFailure,
    repositoryTrust: config.repositoryTrust,
    enforcementMode: config.enforcementMode,
    escalationMode: config.escalationMode,
    configDegraded: config.configDegraded?.length ?? 0,
  });
  return createHash("sha256")
    .update(`${rulesCanonical}#${decisionConfig}`)
    .digest("hex")
    .slice(0, 16);
}
