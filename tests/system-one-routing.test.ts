import { describe, expect, test } from "bun:test";
import {
  resolveConfig,
  reviewBudgetMs,
} from "../src/modules/config/services/config.ts";
import {
  HANDOFF_BUDGET_FLOOR_MS,
  resolveSystemOneRouting,
  type SystemOneRouting,
  systemOneModelWarnings,
  systemOneRoutingWarnings,
} from "../src/modules/config/services/system-one-routing.ts";

const JEV = "opencode/jev-1";
const REVIEWER = { model: "openai/gpt-6-luna" };
const BOTH_ON = {
  systemOneEscalation: "reasoning-first",
  systemOneDenialReview: true,
};

const ESCALATION_NO_REVIEWER =
  'systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; System One escalations still go to you';
const ESCALATION_NOT_JEV =
  'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not a System One model';
const DENIAL_NO_REVIEWER =
  "systemOneDenialReview is inactive: no escalationReviewer is configured; System One denials stay final";
const DENIAL_NOT_JEV =
  "systemOneDenialReview is inactive: the reviewer model is not a System One model";

describe("invalid System One routing values", () => {
  test("the defaults carry no warnings", () => {
    expect("configWarnings" in resolveConfig({})).toBe(false);
  });

  test("an invalid value falls back with a warning and never degrades", () => {
    const config = resolveConfig({
      systemOneEscalation: "Reasoning-First",
      systemOneDenialReview: "yes",
    });
    expect(config.configWarnings).toEqual([
      'systemOneEscalation "Reasoning-First" is not "standard" or "reasoning-first"; using "standard"',
      'systemOneDenialReview "yes" is not a boolean; using false',
    ]);
    expect(config.configDegraded).toBeUndefined();
  });

  test("null and non-string values are named as JSON", () => {
    expect(
      resolveConfig({ systemOneEscalation: null, systemOneDenialReview: 0 })
        .configWarnings,
    ).toEqual([
      'systemOneEscalation null is not "standard" or "reasoning-first"; using "standard"',
      "systemOneDenialReview 0 is not a boolean; using false",
    ]);
  });

  test("a long invalid value is cut in the warning", () => {
    const [warning] =
      resolveConfig({ systemOneEscalation: "x".repeat(500) }).configWarnings ??
      [];
    expect(warning).toBe(
      `systemOneEscalation "${"x".repeat(79)}… is not "standard" or "reasoning-first"; using "standard"`,
    );
  });

  test("source configWarnings are never read back", () => {
    expect(
      resolveConfig({ configWarnings: ["injected"] }).configWarnings,
    ).toBeUndefined();
  });
});

describe("inert routing settings", () => {
  test.each([
    ["the default model", {}, [ESCALATION_NOT_JEV, DENIAL_NOT_JEV]],
    [
      "a non-Jev model with a reviewer",
      { escalationReviewer: REVIEWER },
      [ESCALATION_NOT_JEV, DENIAL_NOT_JEV],
    ],
    [
      "Jev without a reviewer",
      { model: JEV },
      [ESCALATION_NO_REVIEWER, DENIAL_NO_REVIEWER],
    ],
    [
      "Jev with an invalid reviewer",
      { model: JEV, escalationReviewer: { model: "opencode/jev-2" } },
      [ESCALATION_NO_REVIEWER, DENIAL_NO_REVIEWER],
    ],
    ["Jev with a reviewer", { model: JEV, escalationReviewer: REVIEWER }, []],
  ])("%s", (_name, layer, expected) => {
    const config = resolveConfig({ ...BOTH_ON, ...layer });
    expect(systemOneRoutingWarnings(config)).toEqual(expected);
    expect(config.configWarnings).toEqual(
      expected.length > 0 ? expected : undefined,
    );
  });

  test("a setting that is off is never inert", () => {
    expect(systemOneRoutingWarnings(resolveConfig({ model: JEV }))).toEqual([]);
    expect(
      systemOneRoutingWarnings(
        resolveConfig({ model: JEV, systemOneDenialReview: true }),
      ),
    ).toEqual([DENIAL_NO_REVIEWER]);
  });

  test("invalid-value warnings come before inert warnings", () => {
    expect(
      resolveConfig({
        systemOneEscalation: "on",
        systemOneDenialReview: true,
      }).configWarnings,
    ).toEqual([
      'systemOneEscalation "on" is not "standard" or "reasoning-first"; using "standard"',
      DENIAL_NOT_JEV,
    ]);
  });
});

describe("resolveSystemOneRouting", () => {
  const routing = (layer: Record<string, unknown>): SystemOneRouting =>
    resolveSystemOneRouting(resolveConfig(layer));

  test("each setting is active only with Jev and a reviewer", () => {
    const off: SystemOneRouting = {
      reasoningFirst: false,
      denialReview: false,
    };
    expect(routing(BOTH_ON)).toEqual(off);
    expect(routing({ ...BOTH_ON, model: JEV })).toEqual(off);
    expect(routing({ ...BOTH_ON, escalationReviewer: REVIEWER })).toEqual(off);
    expect(
      routing({ ...BOTH_ON, model: JEV, escalationReviewer: REVIEWER }),
    ).toEqual({ reasoningFirst: true, denialReview: true });
  });

  test("the two settings are independent", () => {
    const active = { model: JEV, escalationReviewer: REVIEWER };
    expect(
      routing({ ...active, systemOneEscalation: "reasoning-first" }),
    ).toEqual({ reasoningFirst: true, denialReview: false });
    expect(routing({ ...active, systemOneDenialReview: true })).toEqual({
      reasoningFirst: false,
      denialReview: true,
    });
    expect(routing(active)).toEqual({
      reasoningFirst: false,
      denialReview: false,
    });
  });
});

describe("hand-off budget floor warning", () => {
  const ACTIVE = {
    model: JEV,
    escalationReviewer: REVIEWER,
    timeoutMs: 10_000,
  };
  const floorWarning = (budget: number): string =>
    `reviewBudgetMs ${budget} leaves less than 15000 ms after timeoutMs; hand-offs to the reasoning reviewer will escalate to you instead`;

  test.each([
    ["standard routing", {}],
    ["both routing settings on", BOTH_ON],
  ])("an explicit budget below the floor warns under %s", (_name, keys) => {
    const config = resolveConfig({
      ...ACTIVE,
      ...keys,
      reviewBudgetMs: 24_999,
    });
    expect(config.configWarnings).toEqual([floorWarning(24_999)]);
    expect(config.configDegraded).toBeUndefined();
  });

  test("a budget that leaves exactly the floor does not warn", () => {
    expect(
      resolveConfig({ ...ACTIVE, reviewBudgetMs: 25_000 }).configWarnings,
    ).toBeUndefined();
  });

  test("a budget shorter than timeoutMs names the configured budget", () => {
    expect(
      resolveConfig({
        model: JEV,
        escalationReviewer: REVIEWER,
        reviewBudgetMs: 30_000,
      }).configWarnings,
    ).toEqual([floorWarning(30_000)]);
  });

  test.each([
    ["a non-Jev model", { escalationReviewer: REVIEWER }],
    ["Jev without a reviewer", { model: JEV }],
    [
      "Jev with an invalid reviewer",
      { model: JEV, escalationReviewer: { model: "opencode/jev-2" } },
    ],
  ])("%s gets no floor warning", (_name, layer) => {
    expect(
      resolveConfig({ timeoutMs: 10_000, reviewBudgetMs: 5_000, ...layer })
        .configWarnings,
    ).toBeUndefined();
  });

  test("the default budget never warns, even at the shortest timeouts", () => {
    const config = resolveConfig({
      model: JEV,
      escalationReviewer: { ...REVIEWER, timeoutMs: 5_000 },
      timeoutMs: 5_000,
    });
    expect(config.configWarnings).toBeUndefined();
    expect(reviewBudgetMs(config) - config.timeoutMs).toBeGreaterThanOrEqual(
      HANDOFF_BUDGET_FLOOR_MS,
    );
  });

  test("the floor warning follows the invalid-value warnings", () => {
    expect(
      resolveConfig({
        ...ACTIVE,
        systemOneEscalation: "on",
        reviewBudgetMs: 20_000,
      }).configWarnings,
    ).toEqual([
      'systemOneEscalation "on" is not "standard" or "reasoning-first"; using "standard"',
      floorWarning(20_000),
    ]);
  });

  test("the warning leaves routing unchanged", () => {
    const layer = { ...ACTIVE, ...BOTH_ON };
    expect(
      resolveSystemOneRouting(
        resolveConfig({ ...layer, reviewBudgetMs: 20_000 }),
      ),
    ).toEqual(resolveSystemOneRouting(resolveConfig(layer)));
  });
});

describe("System One model warnings", () => {
  const unbenchmarked = (id: string): string =>
    `openrouter/${id} has not been benchmarked as a reviewer; see REVIEWER-MODELS.md`;
  const incompatible = (id: string, reason: string): string =>
    `openrouter/${id} is known to reject the reviewer's request (${reason}); every review will fail`;

  test.each([
    ["openrouter/typesafe/jev-1.14", []],
    ["openrouter/typesafe/jev-1.14:nitro", []],
    ["openrouter/cloudflare/clef", [unbenchmarked("cloudflare/clef")]],
    [
      "openrouter/cloudflare/clef:nitro",
      [unbenchmarked("cloudflare/clef:nitro")],
    ],
    ["openrouter/typesafe/jev-1.15", [unbenchmarked("typesafe/jev-1.15")]],
    [
      "openrouter/typesafe/jev-1.15:nitro",
      [unbenchmarked("typesafe/jev-1.15:nitro")],
    ],
    [
      "openrouter/respan/span-01",
      [incompatible("respan/span-01", "requires a different state shape")],
    ],
    [
      "openrouter/respan/span-01:nitro",
      [
        incompatible(
          "respan/span-01:nitro",
          "requires a different state shape",
        ),
      ],
    ],
    [
      "openrouter/respan/span-01-lite:free",
      [
        incompatible(
          "respan/span-01-lite:free",
          "requires a different state shape",
        ),
      ],
    ],
    ["liquid-ai/d1", []],
    ["openrouter/anthropic/claude-sonnet-5", []],
  ])("%s model warnings", (model, expected) => {
    expect(resolveConfig({ model }).configWarnings ?? []).toEqual(expected);
    expect(systemOneModelWarnings(resolveConfig({ model }))).toEqual(expected);
  });

  test("follows the invalid-value and routing warnings and precedes the budget floor", () => {
    expect(
      resolveConfig({
        model: "openrouter/cloudflare/clef",
        escalationReviewer: REVIEWER,
        systemOneEscalation: "on",
        timeoutMs: 10_000,
        reviewBudgetMs: 20_000,
      }).configWarnings,
    ).toEqual([
      'systemOneEscalation "on" is not "standard" or "reasoning-first"; using "standard"',
      unbenchmarked("cloudflare/clef"),
      "reviewBudgetMs 20000 leaves less than 15000 ms after timeoutMs; hand-offs to the reasoning reviewer will escalate to you instead",
    ]);
  });
});
