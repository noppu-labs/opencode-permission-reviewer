import type { ReviewerConfig } from "../../../kernel/reviewer-config.ts";
import { isSystemOneReviewerModel } from "./reviewer-model.ts";

/** The least review time a hand-off needs; with less the request escalates. */
export const HANDOFF_BUDGET_FLOOR_MS = 15_000;

export interface SystemOneRouting {
  /** reasoning-first is configured AND active (Jev model + valid escalationReviewer). */
  reasoningFirst: boolean;
  /** denial review is configured AND active (same conditions). */
  denialReview: boolean;
}

/** A non-Jev model is reported first: no escalationReviewer fixes that. */
function inertCause(
  config: ReviewerConfig,
): "not-jev" | "no-reviewer" | undefined {
  if (!isSystemOneReviewerModel(config.model)) return "not-jev";
  if (config.escalationReviewer === undefined) return "no-reviewer";
  return undefined;
}

export function resolveSystemOneRouting(
  config: ReviewerConfig,
): SystemOneRouting {
  const active = inertCause(config) === undefined;
  return {
    reasoningFirst: active && config.systemOneEscalation === "reasoning-first",
    denialReview: active && config.systemOneDenialReview,
  };
}

/** Warnings for settings that are on but inert. */
export function systemOneRoutingWarnings(config: ReviewerConfig): string[] {
  const cause = inertCause(config);
  if (cause === undefined) return [];
  const warnings: string[] = [];
  if (config.systemOneEscalation === "reasoning-first") {
    warnings.push(
      cause === "not-jev"
        ? 'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not Jev'
        : 'systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; Jev escalations still go to you',
    );
  }
  if (config.systemOneDenialReview) {
    warnings.push(
      cause === "not-jev"
        ? "systemOneDenialReview is inactive: the reviewer model is not Jev"
        : "systemOneDenialReview is inactive: no escalationReviewer is configured; Jev denials stay final",
    );
  }
  return warnings;
}

/** Standard routing hands off too, so neither routing key gates this. The
 *  default budget always leaves the floor, so only an explicit one can warn. */
function budgetFloorWarnings(config: ReviewerConfig): string[] {
  const budget = config.reviewBudgetMs;
  if (budget === undefined || inertCause(config) !== undefined) return [];
  if (budget - config.timeoutMs >= HANDOFF_BUDGET_FLOOR_MS) return [];
  return [
    `reviewBudgetMs ${budget} leaves less than ${HANDOFF_BUDGET_FLOOR_MS} ms after timeoutMs; hand-offs to the reasoning reviewer will escalate to you instead`,
  ];
}

const PREVIEW_CHARS = 80;

/** A warning names the value; it does not reproduce it. */
function preview(value: unknown): string {
  const json = JSON.stringify(value) ?? String(value);
  return json.length > PREVIEW_CHARS
    ? `${json.slice(0, PREVIEW_CHARS)}…`
    : json;
}

/** A present source value the resolver did not keep was invalid. */
function invalidValueWarnings(
  config: ReviewerConfig,
  source: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  const { systemOneEscalation: escalation, systemOneDenialReview: denial } =
    source;
  if (escalation !== undefined && escalation !== config.systemOneEscalation) {
    warnings.push(
      `systemOneEscalation ${preview(escalation)} is not "standard" or "reasoning-first"; using "standard"`,
    );
  }
  if (denial !== undefined && denial !== config.systemOneDenialReview) {
    warnings.push(
      `systemOneDenialReview ${preview(denial)} is not a boolean; using false`,
    );
  }
  return warnings;
}

/** configWarnings goes last, after configDegraded: resolveConfig's key order is part of its output. */
export function withSystemOneRoutingWarnings(
  config: ReviewerConfig,
  source: Record<string, unknown>,
): ReviewerConfig {
  const warnings = [
    ...invalidValueWarnings(config, source),
    ...systemOneRoutingWarnings(config),
    ...budgetFloorWarnings(config),
  ];
  return warnings.length === 0
    ? config
    : { ...config, configWarnings: warnings };
}
