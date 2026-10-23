import { asObjectLike } from "../../../utils/is-record.ts";
import { DEFAULT_RISK_POLICY } from "../models/config-risk-policy.ts";

type FailureKnob = "onInvalidDecision" | "onReviewerFailure";

/** Ensure project riskPolicy can only tighten the trusted baseline. */
export function clampRiskPolicy(
  project: Record<string, unknown>,
  trusted: Record<string, unknown>,
): Record<string, unknown> {
  // Start from trusted so partial project objects cannot wipe failure knobs.
  const out: Record<string, unknown> = {
    ...trusted,
    allow: clampAllowMatrix(project.allow, trusted.allow),
  };
  hardenFailureKnob(out, project, trusted, "onInvalidDecision");
  hardenFailureKnob(out, project, trusted, "onReviewerFailure");
  out.minimumConfidence = raisedMinimumConfidence(
    project.minimumConfidence,
    trusted.minimumConfidence,
  );
  return out;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function clampAllowMatrix(
  projectValue: unknown,
  trustedValue: unknown,
): Record<string, unknown> {
  const projectAllow = asObjectLike(projectValue);
  const trustedAllow = asObjectLike(trustedValue) ?? {};
  const clampedAllow: Record<string, unknown> = {};
  for (const risk of ["low", "medium", "high", "critical"] as const) {
    const trustedCell = asArray(trustedAllow[risk]);
    if (projectAllow === undefined) {
      // Project omitted allow entirely: keep the trusted cells.
      clampedAllow[risk] = trustedCell;
      continue;
    }
    const projectCell = asArray(projectAllow[risk]);
    // Intersection: project can only remove, never add. Missing project cell →
    // empty intersection (most restrictive) when the project provided an allow
    // object at all.
    clampedAllow[risk] = trustedCell.filter((auth) =>
      projectCell.includes(auth),
    );
  }
  return clampedAllow;
}

/** Failure knobs: project may harden manual → deny only. */
function hardenFailureKnob(
  out: Record<string, unknown>,
  project: Record<string, unknown>,
  trusted: Record<string, unknown>,
  knob: FailureKnob,
): void {
  if (project[knob] === "deny" || trusted[knob] === "deny") {
    out[knob] = "deny";
  } else if (project[knob] === "manual" || project[knob] === undefined) {
    out[knob] = trusted[knob] ?? "manual";
  }
}

/** minimumConfidence: project can raise but not lower. */
function raisedMinimumConfidence(
  projectValue: unknown,
  trustedValue: unknown,
): number {
  const trustedMin =
    typeof trustedValue === "number" && Number.isFinite(trustedValue)
      ? trustedValue
      : DEFAULT_RISK_POLICY.minimumConfidence;
  if (typeof projectValue === "number" && Number.isFinite(projectValue))
    return Math.max(trustedMin, projectValue);
  return trustedMin;
}
