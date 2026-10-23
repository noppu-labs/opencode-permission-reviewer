import type { PolicyRule } from "../../../kernel/reviewer-config.ts";
import { isRecord } from "../../../utils/is-record.ts";
import { DEFAULT_RISK_POLICY } from "../models/config-risk-policy.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { clampRiskPolicy } from "./risk-policy-clamp.ts";
import {
  CONFIDENCE_FLOOR_KEYS,
  TRUSTED_ONLY_KEYS,
} from "./trust-boundary-keys.ts";

/** Whether the key is present in the layer (a `null`/wrong-type value must be
 *  handled as a present-but-invalid override, never silently forwarded). */
function hasKey(object: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(object, key);
}

/** Merge the trusted baseline with the untrusted project layer. Project config
 *  can only TIGHTEN security-sensitive fields, never weaken them. A project
 *  value of the wrong type (including `null`) is dropped so it can never fall
 *  through to `resolveConfig`'s defaults and reset a trusted restriction. */
export function mergeWithTrustBoundary(
  trusted: Record<string, unknown>,
  project: Record<string, unknown>,
): Record<string, unknown> {
  const clamped = { ...project };
  for (const key of TRUSTED_ONLY_KEYS) delete clamped[key];
  clampConfidenceFloors(clamped, trusted);
  // audit: project can enable but not disable.
  if (clamped.audit === false && trusted.audit !== false) delete clamped.audit;
  // repositoryTrust: the project layer may only declare its own repository
  // untrusted; it cannot grant "trusted" or reset a trusted "untrusted".
  if (clamped.repositoryTrust !== "untrusted") delete clamped.repositoryTrust;
  clampEnforcementMode(clamped, trusted);
  clampProjectRiskPolicy(clamped, trusted);
  clampEscalationMode(clamped, trusted);
  clampSystemOneRouting(clamped);
  combinePolicyRules(clamped, trusted);
  return { ...trusted, ...clamped };
}

/** Non-numeric values (including null) are dropped so they cannot reset a
 *  trusted floor. */
function clampConfidenceFloors(
  clamped: Record<string, unknown>,
  trusted: Record<string, unknown>,
): void {
  for (const key of CONFIDENCE_FLOOR_KEYS) {
    if (!hasKey(clamped, key)) continue;
    const value = clamped[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      delete clamped[key];
      continue;
    }
    const floor =
      typeof trusted[key] === "number"
        ? (trusted[key] as number)
        : DEFAULT_CONFIG[key];
    if (value < floor) clamped[key] = floor;
  }
}

/** enforcementMode: project cannot enable OR disable enforcement — only
 *  global/inline can. A project "enforce" is deleted (can't enable), and a
 *  project "observe" when the trusted baseline is "enforce" is also deleted
 *  (can't downgrade from a global enforcement setting). */
function clampEnforcementMode(
  clamped: Record<string, unknown>,
  trusted: Record<string, unknown>,
): void {
  if (clamped.enforcementMode === undefined) return;
  if (
    clamped.enforcementMode === "enforce" ||
    trusted.enforcementMode === "enforce"
  ) {
    delete clamped.enforcementMode;
  }
}

/** riskPolicy: project can narrow allow cells and harden failure knobs, never
 *  relax a trusted deny or widen an allow cell. A non-object value (including
 *  null) is ignored entirely so it cannot wipe the trusted matrix. */
function clampProjectRiskPolicy(
  clamped: Record<string, unknown>,
  trusted: Record<string, unknown>,
): void {
  if (!hasKey(clamped, "riskPolicy")) return;
  if (!isRecord(clamped.riskPolicy)) {
    delete clamped.riskPolicy;
    return;
  }
  const trustedPolicy = isRecord(trusted.riskPolicy)
    ? trusted.riskPolicy
    : (DEFAULT_RISK_POLICY as unknown as Record<string, unknown>);
  clamped.riskPolicy = clampRiskPolicy(clamped.riskPolicy, trustedPolicy);
}

/** escalationMode: project can only harden manual → deny, never relax deny →
 *  manual. Invalid values are dropped so they cannot override a trusted deny
 *  through resolveConfig's "anything but deny → manual" fallback. */
function clampEscalationMode(
  clamped: Record<string, unknown>,
  trusted: Record<string, unknown>,
): void {
  const mode = clamped.escalationMode;
  if (mode === undefined) return;
  const invalid = mode !== "manual" && mode !== "deny";
  const relaxes = mode === "manual" && trusted.escalationMode === "deny";
  if (invalid || relaxes) delete clamped.escalationMode;
}

/** systemOneEscalation and systemOneDenialReview: a repository may keep Jev's
 *  escalations and denials with the human ("standard", false) but can never
 *  turn either hand-off on. Any other value, including null, is dropped. */
function clampSystemOneRouting(clamped: Record<string, unknown>): void {
  if (clamped.systemOneEscalation !== "standard") {
    delete clamped.systemOneEscalation;
  }
  if (clamped.systemOneDenialReview !== false) {
    delete clamped.systemOneDenialReview;
  }
}

/** policyRules: the project layer ADDS rules (which can only tighten — its
 *  allow rules are filtered by the engine), it never erases trusted
 *  global/inline deny/manual rules. Combine instead of replace so a repo
 *  cannot weaken policy by declaring an empty or narrower rule set. Project
 *  rules are also re-tagged source:"project" so they cannot spoof
 *  source:"inline" to bypass the project-allow filter. */
function combinePolicyRules(
  clamped: Record<string, unknown>,
  trusted: Record<string, unknown>,
): void {
  if (Array.isArray(clamped.policyRules)) {
    const projectRules = (
      clamped.policyRules as Array<Record<string, unknown>>
    ).map((rule) => ({
      ...rule,
      source: "project" as PolicyRule["source"],
    }));
    const trustedRules = Array.isArray(trusted.policyRules)
      ? trusted.policyRules
      : [];
    clamped.policyRules = [...trustedRules, ...projectRules];
  } else if (Array.isArray(trusted.policyRules)) {
    // Project omitted policyRules entirely: preserve the trusted rules.
    clamped.policyRules = trusted.policyRules;
  }
}
