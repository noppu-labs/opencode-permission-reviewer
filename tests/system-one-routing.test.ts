import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../src/config.ts";
import {
  resolveSystemOneRouting,
  type SystemOneRouting,
  systemOneRoutingWarnings,
} from "../src/system-one-routing.ts";

const JEV = "opencode/jev-1";
const REVIEWER = { model: "openai/gpt-6-luna" };
const BOTH_ON = {
  systemOneEscalation: "reasoning-first",
  systemOneDenialReview: true,
};

const ESCALATION_NO_REVIEWER =
  'systemOneEscalation "reasoning-first" is inactive: no escalationReviewer is configured; Jev escalations still go to you';
const ESCALATION_NOT_JEV =
  'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not Jev';
const DENIAL_NO_REVIEWER =
  "systemOneDenialReview is inactive: no escalationReviewer is configured; Jev denials stay final";
const DENIAL_NOT_JEV =
  "systemOneDenialReview is inactive: the reviewer model is not Jev";

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
