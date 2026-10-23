import type { ReviewerConfig } from "../../../types.ts";

export function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

type NumericKey = {
  [K in keyof ReviewerConfig]-?: ReviewerConfig[K] extends number ? K : never;
}[keyof ReviewerConfig];

type KnobBounds<K extends NumericKey> = Readonly<
  Record<K, readonly [min: number, max: number]>
>;

/** The total review deadline: absent when the source omits it, otherwise an
 *  integer clamped to [5 s, 15 min], or 3 min when the value is not one. */
export function reviewBudgetKnob(
  source: Record<string, unknown>,
): Pick<ReviewerConfig, "reviewBudgetMs"> {
  return source.reviewBudgetMs === undefined
    ? {}
    : {
        reviewBudgetMs: boundedInteger(
          source.reviewBudgetMs,
          180_000,
          5_000,
          900_000,
        ),
      };
}

export const REVIEW_TIMEOUT: KnobBounds<"timeoutMs"> = {
  timeoutMs: [5_000, 600_000],
};

export const CONTEXT_BUDGETS: KnobBounds<
  | "maxContextChars"
  | "maxPartChars"
  | "maxEnrichmentChars"
  | "maxIntentChars"
  | "transcriptMessages"
  | "intentMessages"
  | "historyMessages"
> = {
  maxContextChars: [4_000, 200_000],
  maxPartChars: [500, 50_000],
  maxEnrichmentChars: [1_000, 100_000],
  maxIntentChars: [1_000, 50_000],
  transcriptMessages: [1, 100],
  intentMessages: [1, 50],
  historyMessages: [20, 500],
};

export const CONFIDENCE_FLOORS: KnobBounds<
  | "confidenceThreshold"
  | "systemOneConfidenceThreshold"
  | "systemOneReasoningThreshold"
> = {
  confidenceThreshold: [0.5, 1],
  systemOneConfidenceThreshold: [0.3, 1],
  systemOneReasoningThreshold: [0, 1],
};

export const LINEAGE_LIMITS: KnobBounds<
  "maxSessionDepth" | "maxParentSessions"
> = {
  maxSessionDepth: [1, 32],
  maxParentSessions: [0, 32],
};

function clampKnobs<K extends NumericKey>(
  source: Record<string, unknown>,
  bounds: KnobBounds<K>,
  defaults: ReviewerConfig,
  clamp: typeof boundedInteger,
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const key of Object.keys(bounds) as K[]) {
    const [min, max] = bounds[key];
    out[key] = clamp(source[key], defaults[key], min, max);
  }
  return out;
}

/** Each knob in table order, clamped to an integer in its bounds; a missing
 *  or non-integer value falls back to its default. */
export function integerKnobs<K extends NumericKey>(
  source: Record<string, unknown>,
  bounds: KnobBounds<K>,
  defaults: ReviewerConfig,
): Record<K, number> {
  return clampKnobs(source, bounds, defaults, boundedInteger);
}

/** Each knob in table order, clamped to a finite number in its bounds; a
 *  missing or non-finite value falls back to its default. */
export function numberKnobs<K extends NumericKey>(
  source: Record<string, unknown>,
  bounds: KnobBounds<K>,
  defaults: ReviewerConfig,
): Record<K, number> {
  return clampKnobs(source, bounds, defaults, boundedNumber);
}
