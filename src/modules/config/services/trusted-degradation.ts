import { isValidEscalationReviewer } from "../../reviewer/services/reviewer-model.ts";
import { countInvalidPolicyRules } from "../models/config-policy-rules.ts";
import type { ConfigLayer } from "./layer-read.ts";
import type { InlineOptionsTrust } from "./sources.ts";

/** Trusted mode fields and the values resolveConfig honors. A mistyped mode
 *  silently falls back to the less restrictive default in resolveConfig, so it
 *  gets the same fail-closed treatment as a dropped rule: visible degradation
 *  instead of a quiet downgrade. */
const MODE_FIELDS = [
  ["enforcementMode", ["enforce", "observe"]],
  ["escalationMode", ["manual", "deny"]],
] as const;

function invalidEscalationReviewer(
  raw: Record<string, unknown>,
  layer: "global" | "inline",
): string[] {
  return raw.escalationReviewer !== undefined &&
    !isValidEscalationReviewer(raw.escalationReviewer)
    ? [`${layer} config escalationReviewer is invalid and was ignored`]
    : [];
}

function invalidModes(
  raw: Record<string, unknown>,
  layer: "global" | "inline",
): string[] {
  const invalid: string[] = [];
  for (const [key, valid] of MODE_FIELDS) {
    const value = raw[key];
    if (value !== undefined && !(valid as readonly unknown[]).includes(value)) {
      invalid.push(
        `${layer} config ${key} ${JSON.stringify(value)} is invalid and was ignored`,
      );
    }
  }
  return invalid;
}

function warnUntilFixed(entries: string[]): string[] {
  for (const entry of entries) {
    console.warn(
      `permission-reviewer: ${entry}; automatic approval stays disabled until it is fixed`,
    );
  }
  return entries;
}

/** A TRUSTED layer that exists but cannot be honored may have lost the very
 *  restrictions it was supposed to carry (deny rules, enforce mode, stricter
 *  thresholds). That must degrade the config — automatic approval stays off
 *  until the file is fixed — instead of quietly reactivating defaults. Each
 *  reason found in a readable global file is also warned about. */
export function globalLayerDegradation(layer: ConfigLayer): string[] {
  if (layer.status === "malformed")
    return ["global config file is malformed and was ignored"];
  if (layer.status === "read-error")
    return ["global config file exists but could not be read"];
  if (layer.status !== "ok") return [];
  const degraded = warnUntilFixed(
    invalidEscalationReviewer(layer.raw, "global"),
  );
  const invalidRules = countInvalidPolicyRules(layer.raw.policyRules);
  if (invalidRules > 0) {
    degraded.push(
      `${invalidRules} policy rule(s) from the global config were dropped by validation`,
    );
    console.warn(
      `permission-reviewer: ${invalidRules} policy rule(s) in the global config are invalid and were dropped; automatic approval stays disabled until they are fixed`,
    );
  }
  return [...degraded, ...warnUntilFixed(invalidModes(layer.raw, "global"))];
}

/** Same visibility for trusted inline options, without console.warn.
 *  resolveConfig still clamps each value to the safe default; this only
 *  records that the trusted input was lost. */
export function inlineDegradation(
  inlineOptions: Record<string, unknown> | undefined,
  inlineTrust: InlineOptionsTrust,
): string[] {
  if (inlineTrust !== "trusted") return [];
  const invalidRules = countInvalidPolicyRules(inlineOptions?.policyRules);
  const degraded =
    invalidRules > 0
      ? [
          `${invalidRules} policy rule(s) from inline config were dropped by validation`,
        ]
      : [];
  if (inlineOptions === undefined) return degraded;
  return [
    ...degraded,
    ...invalidEscalationReviewer(inlineOptions, "inline"),
    ...invalidModes(inlineOptions, "inline"),
  ];
}
