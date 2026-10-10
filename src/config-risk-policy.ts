import type { RiskPolicy, UserAuthorization } from "./types.ts";

/** Default risk×authorization matrix. Reproduces exactly the previous
 *  hard-coded gate: critical never auto-allows; high needs at least medium auth;
 *  medium needs at least low auth; low allows any auth including unknown. */
export const DEFAULT_RISK_POLICY: RiskPolicy = {
  allow: {
    low: ["high", "medium", "low", "unknown"],
    medium: ["high", "medium", "low"],
    high: ["high", "medium"],
    critical: [],
  },
  minimumConfidence: 0.7,
  onInvalidDecision: "manual",
  onReviewerFailure: "manual",
};

const VALID_AUTH = new Set(["high", "medium", "low", "unknown"]);

/** Parse a risk×authorization matrix. Invalid or partial entries fall back to
 *  the conservative default. Failure-mode knobs only accept the stricter
 *  `"deny"` override; anything else keeps the default `"manual"`. */
export function resolveRiskPolicy(value: unknown): RiskPolicy {
  if (typeof value !== "object" || value === null)
    return { ...DEFAULT_RISK_POLICY, allow: { ...DEFAULT_RISK_POLICY.allow } };
  const src = value as Record<string, unknown>;
  return {
    allow: resolveAllowMatrix(src.allow),
    minimumConfidence: resolveMinimumConfidence(src.minimumConfidence),
    // Prefer an explicit deny from either the field or a pre-clamped trusted
    // baseline (loader may have already hardened the knob).
    onInvalidDecision:
      src.onInvalidDecision === "deny"
        ? "deny"
        : DEFAULT_RISK_POLICY.onInvalidDecision,
    onReviewerFailure:
      src.onReviewerFailure === "deny"
        ? "deny"
        : DEFAULT_RISK_POLICY.onReviewerFailure,
  };
}

function resolveAllowMatrix(value: unknown): RiskPolicy["allow"] {
  const allowSrc = typeof value === "object" && value !== null ? value : {};
  const allow = { ...DEFAULT_RISK_POLICY.allow };
  for (const risk of ["low", "medium", "high", "critical"] as const) {
    const cell = (allowSrc as Record<string, unknown>)[risk];
    if (!Array.isArray(cell)) continue;
    allow[risk] = cell.filter(
      (a) => typeof a === "string" && VALID_AUTH.has(a),
    ) as UserAuthorization[];
  }
  return allow;
}

function resolveMinimumConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_RISK_POLICY.minimumConfidence;
  return Math.min(1, Math.max(0.5, value));
}
