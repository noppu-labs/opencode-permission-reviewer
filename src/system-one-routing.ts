import { isSystemOneReviewerModel } from "./reviewer-model.ts";
import type { ReviewerConfig } from "./types.ts";

export interface SystemOneRouting {
  /** reasoning-first is configured AND active (Jev model + valid escalationReviewer). */
  reasoningFirst: boolean;
  /** denial review is configured AND active (same conditions). */
  denialReview: boolean;
}

/** Why a configured routing setting cannot take effect, or undefined when it
 *  can. A non-Jev model is named first: no reviewer fixes that. */
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

/** Warnings for settings that are on but inert; [] when none. */
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

const PREVIEW_CHARS = 80;

/** The value as JSON, cut to a readable length; a warning names the value,
 *  it does not reproduce it. */
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

/** The resolved config with `configWarnings` appended (last, after
 *  configDegraded) when any routing value was invalid or is inert. */
export function withSystemOneRoutingWarnings(
  config: ReviewerConfig,
  source: Record<string, unknown>,
): ReviewerConfig {
  const warnings = [
    ...invalidValueWarnings(config, source),
    ...systemOneRoutingWarnings(config),
  ];
  return warnings.length === 0
    ? config
    : { ...config, configWarnings: warnings };
}
