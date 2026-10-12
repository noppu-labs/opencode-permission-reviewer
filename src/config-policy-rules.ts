import { validateCondition } from "./config-rule-condition.ts";
import type { PolicyRule } from "./types.ts";

const VALID_EFFECTS: ReadonlySet<string> = new Set([
  "review",
  "manual",
  "deny",
  "allow",
]);
const VALID_SOURCES: ReadonlySet<string> = new Set([
  "builtin",
  "global",
  "project",
  "inline",
]);

/** The fields every rule needs, already checked against their closed sets. */
interface RuleFields {
  id: string;
  source: PolicyRule["source"];
  effect: PolicyRule["effect"];
  reason: string;
  when?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasRuleFields(r: Record<string, unknown>): r is RuleFields & {
  [key: string]: unknown;
} {
  return (
    isNonEmptyString(r.id) &&
    typeof r.source === "string" &&
    VALID_SOURCES.has(r.source) &&
    typeof r.effect === "string" &&
    VALID_EFFECTS.has(r.effect) &&
    isNonEmptyString(r.reason)
  );
}

/** Parse one declarative policy rule. Malformed entries return null so the
 *  caller decides whether dropping them is safe (untrusted layer) or must
 *  degrade the config (trusted layer — a dropped restriction may be the whole
 *  point of the rule). A missing `when` is a valid universal rule. */
function parsePolicyRule(raw: unknown): PolicyRule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!hasRuleFields(r)) return null;
  // No `when` at all: a universal rule. `{ always: true }` is the explicit
  // spelling of the same thing for admins who prefer it.
  if (r.when === undefined)
    return { id: r.id, source: r.source, effect: r.effect, reason: r.reason };
  if (typeof r.when !== "object" || r.when === null) return null;
  const when = validateCondition(r.when as Record<string, unknown>);
  if (when === null) return null;
  return {
    id: r.id,
    source: r.source,
    when,
    effect: r.effect,
    reason: r.reason,
  };
}

/** Parse declarative policy rules. Malformed entries are dropped. */
export function resolvePolicyRules(value: unknown): PolicyRule[] {
  if (!Array.isArray(value)) return [];
  const out: PolicyRule[] = [];
  for (const raw of value) {
    const rule = parsePolicyRule(raw);
    if (rule !== null) out.push(rule);
  }
  return out;
}

/** How many entries a policyRules array would silently drop under
 *  `resolvePolicyRules`. Trusted layers use this to refuse silent degradation:
 *  an admin rule that vanishes on a typo must block auto-approval, not just
 *  disappear. */
export function countInvalidPolicyRules(value: unknown): number {
  if (value === undefined) return 0;
  if (!Array.isArray(value)) return 1;
  return value.filter((raw) => parsePolicyRule(raw) === null).length;
}
