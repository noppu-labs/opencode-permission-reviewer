import { isRecord } from "./is-record.ts";
import type { ReviewDecision } from "./types.ts";
import type { ReviewUiStatus } from "./ui-protocol.ts";

// Structural checks for a decoded UI status payload. A payload passes only
// when every field holds a value the protocol defines; it is then returned
// as is, unknown extra fields included.

type Check = (value: unknown) => boolean;

const oneOf =
  (allowed: readonly unknown[]): Check =>
  (value: unknown): boolean =>
    allowed.includes(value);
const isString: Check = (value: unknown): boolean => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const optional =
  (check: Check): Check =>
  (value: unknown): boolean =>
    value === undefined || check(value);

/** True when every field named in `checks` passes its check. */
function fieldsPass(
  value: Record<string, unknown>,
  checks: Record<string, Check>,
): boolean {
  return Object.entries(checks).every(([key, check]) => check(value[key]));
}

const DECISION_CHECKS: Record<string, Check> = {
  outcome: oneOf(["allow", "deny", "escalate"]),
  risk_level: oneOf(["low", "medium", "high", "critical"]),
  user_authorization: oneOf(["high", "medium", "low", "unknown"]),
  rationale: isString,
  confidence: (value: unknown): boolean =>
    isFiniteNumber(value) && value >= 0 && value <= 1,
};

function isDecision(value: unknown): value is ReviewDecision {
  return isRecord(value) && fieldsPass(value, DECISION_CHECKS);
}

const STATUS_CHECKS: Record<string, Check> = {
  version: (value: unknown): boolean => value === 1,
  requestID: isString,
  sessionID: isString,
  phase: oneOf(["reviewing", "approved", "denied", "manual", "unknown"]),
  permission: isString,
  action: isString,
  model: isString,
  variant: isString,
  emittedAt: isFiniteNumber,
  timeoutMs: (value: unknown): boolean => isFiniteNumber(value) && value >= 0,
  reason: optional(isString),
  decision: optional(isDecision),
  escalationDisposition: optional(oneOf(["manual", "deny"])),
  actorName: optional(isString),
  actorProfile: optional(
    oneOf([
      "read-only",
      "validation",
      "workspace",
      "operator",
      "reviewer",
      "unknown",
    ]),
  ),
};

export function parseUiStatus(value: unknown): ReviewUiStatus | undefined {
  if (!(isRecord(value) && fieldsPass(value, STATUS_CHECKS))) return;
  return value as unknown as ReviewUiStatus;
}
