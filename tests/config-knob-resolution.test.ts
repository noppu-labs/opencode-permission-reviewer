import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  resolveConfig,
  reviewBudgetMs,
} from "../src/config.ts";
import type { ReviewerConfig } from "../src/types.ts";

type Knob = [key: keyof ReviewerConfig, min: number, max: number];

const INTEGER_KNOBS: Knob[] = [
  ["timeoutMs", 5_000, 600_000],
  ["maxContextChars", 4_000, 200_000],
  ["maxPartChars", 500, 50_000],
  ["maxEnrichmentChars", 1_000, 100_000],
  ["maxIntentChars", 1_000, 50_000],
  ["transcriptMessages", 1, 100],
  ["intentMessages", 1, 50],
  ["historyMessages", 20, 500],
  ["maxSessionDepth", 1, 32],
  ["maxParentSessions", 0, 32],
];

const NUMBER_KNOBS: Knob[] = [
  ["confidenceThreshold", 0.5, 1],
  ["systemOneConfidenceThreshold", 0.3, 1],
  ["systemOneReasoningThreshold", 0, 1],
];

function resolved(key: string, value: unknown): unknown {
  return resolveConfig({ [key]: value })[key as keyof ReviewerConfig];
}

describe("resolveConfig clamps every numeric knob to its bounds", () => {
  test.each(INTEGER_KNOBS)("integer knob %s", (key, min, max) => {
    expect(resolved(key, min - 1)).toBe(min);
    expect(resolved(key, max + 1)).toBe(max);
    expect(resolved(key, min)).toBe(min);
    expect(resolved(key, max)).toBe(max);
    const wrong = [min + 0.5, Number.NaN, Infinity, "7", null];
    expect(wrong.map((value) => resolved(key, value))).toEqual(
      wrong.map(() => DEFAULT_CONFIG[key]),
    );
  });

  test.each(NUMBER_KNOBS)("finite number knob %s", (key, min, max) => {
    expect(resolved(key, min - 0.01)).toBe(min);
    expect(resolved(key, max + 0.01)).toBe(max);
    expect(resolved(key, 0.95)).toBe(0.95);
    const wrong = [Number.NaN, Infinity, -Infinity, "0.9", null];
    expect(wrong.map((value) => resolved(key, value))).toEqual(
      wrong.map(() => DEFAULT_CONFIG[key]),
    );
  });

  test("reviewBudgetMs is omitted unless set, and clamped when set", () => {
    expect("reviewBudgetMs" in resolveConfig({})).toBe(false);
    expect(resolved("reviewBudgetMs", 1)).toBe(5_000);
    expect(resolved("reviewBudgetMs", 10_000_000)).toBe(900_000);
    expect(resolved("reviewBudgetMs", 200_000)).toBe(200_000);
    // A present but wrong-kind value falls back to 180 s, not to the
    // derived default.
    expect(resolved("reviewBudgetMs", null)).toBe(180_000);
    expect(resolved("reviewBudgetMs", 1.5)).toBe(180_000);
  });
});

describe("reviewBudgetMs", () => {
  const reviewer = (timeoutMs?: number): Record<string, unknown> => ({
    model: "openai/gpt-6-luna",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const budget = (source: Record<string, unknown>): number =>
    reviewBudgetMs(resolveConfig({ timeoutMs: 30_000, ...source }));

  test("the derived budget is timeoutMs plus the longer of the two timeouts plus a minute", () => {
    expect(budget({})).toBe(120_000);
    expect(budget({ escalationReviewer: reviewer(200_000) })).toBe(290_000);
  });

  test("a reviewer shorter than timeoutMs leaves the budget at 2 * timeoutMs + 60 s", () => {
    expect(budget({ escalationReviewer: reviewer(10_000) })).toBe(120_000);
    expect(
      reviewBudgetMs(
        resolveConfig({
          timeoutMs: 300_000,
          escalationReviewer: reviewer(5_000),
        }),
      ),
    ).toBe(660_000);
  });

  test("a reviewer without its own timeout counts the builtin 120 s, not timeoutMs", () => {
    expect(budget({ escalationReviewer: reviewer() })).toBe(210_000);
    // Both timeouts default to 120 s, which gives 2 * timeoutMs + 60 s.
    expect(
      reviewBudgetMs(resolveConfig({ escalationReviewer: reviewer() })),
    ).toBe(300_000);
    expect(
      reviewBudgetMs(
        resolveConfig({ timeoutMs: 300_000, escalationReviewer: reviewer() }),
      ),
    ).toBe(660_000);
  });

  test("an explicit reviewBudgetMs still wins", () => {
    expect(
      budget({ reviewBudgetMs: 90_000, escalationReviewer: reviewer(200_000) }),
    ).toBe(90_000);
  });
});

describe("resolveConfig flags, modes and text fields", () => {
  test.each([
    "retainReviewSessions",
    "audit",
    "debug",
    "askDecisions",
  ] as const)("boolean %s keeps a boolean and ignores anything else", (key) => {
    expect(resolved(key, true)).toBe(true);
    expect(resolved(key, false)).toBe(false);
    expect(resolved(key, "true")).toBe(DEFAULT_CONFIG[key]);
    expect(resolved(key, 1)).toBe(DEFAULT_CONFIG[key]);
  });

  test("model needs a provider/model slash; variant must be non-empty", () => {
    expect(resolved("model", "a/b")).toBe("a/b");
    expect(resolved("model", "no-slash")).toBe(DEFAULT_CONFIG.model);
    expect(resolved("model", 5)).toBe(DEFAULT_CONFIG.model);
    expect(resolved("variant", "high")).toBe("high");
    expect(resolved("variant", "")).toBe(DEFAULT_CONFIG.variant);
    expect(resolved("variant", 5)).toBe(DEFAULT_CONFIG.variant);
  });

  test("only exact mode spellings are honored", () => {
    expect(resolved("outputFormat", "text")).toBe("text");
    expect(resolved("outputFormat", "TEXT")).toBe("json_schema");
    expect(resolved("enforcementMode", "enforce")).toBe("enforce");
    expect(resolved("enforcementMode", "ENFORCE")).toBe("observe");
    expect(resolved("escalationMode", "deny")).toBe("deny");
    expect(resolved("escalationMode", "DENY")).toBe("manual");
    expect(resolved("repositoryTrust", "trusted")).toBe("trusted");
    expect(resolved("repositoryTrust", "untrusted")).toBe("untrusted");
    expect(resolved("repositoryTrust", "TRUSTED")).toBe("unknown");
  });

  test("System One routing keys keep only exact valid values", () => {
    expect(DEFAULT_CONFIG.systemOneEscalation).toBe("standard");
    expect(DEFAULT_CONFIG.systemOneDenialReview).toBe(false);
    const escalations = [
      "standard",
      "reasoning-first",
      "Reasoning-First",
      "",
      1,
      null,
    ];
    expect(
      escalations.map((value) => resolved("systemOneEscalation", value)),
    ).toEqual([
      "standard",
      "reasoning-first",
      "standard",
      "standard",
      "standard",
      "standard",
    ]);
    const denials = [true, false, "true", 1, null];
    expect(
      denials.map((value) => resolved("systemOneDenialReview", value)),
    ).toEqual([true, false, false, false, false]);
  });

  test.each(["policy", "auditPath"])(
    "%s is trimmed and omitted when blank",
    (key) => {
      expect(resolved(key, "  text  ")).toBe("text");
      const blanks = ["", "   ", 5, null];
      expect(
        blanks.map((blank) => key in resolveConfig({ [key]: blank })),
      ).toEqual([false, false, false, false]);
    },
  );
});
