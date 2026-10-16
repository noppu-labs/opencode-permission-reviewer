import { isRecord } from "./is-record.ts";
import type { HandoffInfo } from "./system-one/backend.ts";
import type {
  HandoffTrigger,
  ManualResolution,
  ReviewDecision,
} from "./types.ts";
import type { ActionSegment, ReviewUiStatus } from "./ui-protocol.ts";

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

const DECISION_CHECKS: Partial<Record<keyof ReviewDecision, Check>> = {
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

// Keyed records, so a trigger or resolution added to the union without a
// check here fails to compile.
const HANDOFF_TRIGGERS: Record<HandoffTrigger, true> = {
  "jev-escalate": true,
  "jev-uncertain-allow": true,
  "jev-gate": true,
  "jev-invalid": true,
  "jev-failure": true,
  "jev-uncertain-deny": true,
};

const RESOLUTIONS: Record<ManualResolution, true> = {
  reviewer: true,
  "reasoning-escalated": true,
  "reasoning-unavailable": true,
  "budget-exhausted": true,
};

const isStringList: Check = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const HANDOFF_CHECKS: Record<keyof HandoffInfo, Check> = {
  from: isString,
  to: isString,
  trigger: oneOf(Object.keys(HANDOFF_TRIGGERS)),
  failureKind: optional(isString),
};

const isHandoff: Check = (value: unknown): boolean =>
  isRecord(value) && fieldsPass(value, HANDOFF_CHECKS);

const SEGMENT_CHECKS: Record<keyof ActionSegment, Check> = {
  text: isString,
  separator: optional(oneOf(["|", "||", "&&", ";", "&"])),
  heredocLines: optional(
    (value: unknown): boolean =>
      isFiniteNumber(value) && Number.isInteger(value) && value >= 0,
  ),
};

const isActionSegments: Check = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (segment: unknown): boolean =>
      isRecord(segment) && fieldsPass(segment, SEGMENT_CHECKS),
  );

const STATUS_CHECKS: Record<keyof ReviewUiStatus, Check> = {
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
  handoff: optional(isHandoff),
  resolution: optional(oneOf(Object.keys(RESOLUTIONS))),
  decidedBy: optional(isString),
  configWarnings: optional(isStringList),
  configDegraded: optional(isStringList),
  actionSegments: optional(isActionSegments),
};

export function parseUiStatus(value: unknown): ReviewUiStatus | undefined {
  if (!(isRecord(value) && fieldsPass(value, STATUS_CHECKS))) return;
  return value as unknown as ReviewUiStatus;
}
