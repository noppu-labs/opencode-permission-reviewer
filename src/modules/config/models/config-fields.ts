import type {
  ActorProfile,
  EscalationMode,
  RepositoryTrust,
  ReviewerConfig,
} from "../../../kernel/reviewer-config.ts";
import { ACTOR_PROFILES } from "./config-rule-condition.ts";

/** Parse a trusted name→profile mapping. Invalid entries are dropped. */
export function resolveActorProfiles(
  value: unknown,
): Record<string, ActorProfile> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, ActorProfile> = {};
  for (const [name, profile] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      typeof profile === "string" &&
      ACTOR_PROFILES.has(profile as ActorProfile)
    ) {
      out[name] = profile as ActorProfile;
    }
  }
  return out;
}

export function resolveEscalationMode(value: unknown): EscalationMode {
  return value === "deny" ? "deny" : "manual";
}

/** An invalid value falls back to the default, which adds no hand-off to the
 *  escalation reviewer, so system-one-routing.ts reports it as a config
 *  warning, never degradation. */
export function systemOneRoutingFields(
  source: Record<string, unknown>,
): Pick<ReviewerConfig, "systemOneEscalation" | "systemOneDenialReview"> {
  return {
    systemOneEscalation:
      source.systemOneEscalation === "reasoning-first"
        ? "reasoning-first"
        : "standard",
    systemOneDenialReview: source.systemOneDenialReview === true,
  };
}

export function resolveRepositoryTrust(value: unknown): RepositoryTrust {
  if (value === "trusted") return "trusted";
  if (value === "untrusted") return "untrusted";
  return "unknown";
}

export function nonEmptyStringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** The trimmed string, or undefined when it is not a string or is blank. */
export function trimmedText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** A single-key object for a present value and an empty one for an absent
 *  value, so an optional field keeps its place in the output key order. */
export function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
