import { describe, expect, test } from "bun:test";
import { loadLayers } from "./config-layer-fixtures.ts";

const BAD_RULE = { id: "", source: "global", effect: "deny", reason: "x" };
const INVALID: Record<string, unknown> = {
  escalationReviewer: { model: "no-slash" },
  policyRules: [BAD_RULE, BAD_RULE],
  enforcementMode: "ENFORCE",
  escalationMode: "DENY",
};
const UNTIL_FIXED = "automatic approval stays disabled until it is fixed";

describe("trusted layers that cannot be honored degrade the config", () => {
  test("every invalid global and inline field is recorded, in a fixed order", () => {
    const { config, warnings } = loadLayers({
      global: INVALID,
      inline: { ...INVALID, policyRules: [BAD_RULE] },
    });
    expect(config.configDegraded).toEqual([
      "global config escalationReviewer is invalid and was ignored",
      "2 policy rule(s) from the global config were dropped by validation",
      'global config enforcementMode "ENFORCE" is invalid and was ignored',
      'global config escalationMode "DENY" is invalid and was ignored',
      "1 policy rule(s) from inline config were dropped by validation",
      "inline config escalationReviewer is invalid and was ignored",
      'inline config enforcementMode "ENFORCE" is invalid and was ignored',
      'inline config escalationMode "DENY" is invalid and was ignored',
    ]);
    // Only the global file is warned about; inline input is recorded only.
    expect(warnings).toEqual([
      `permission-reviewer: global config escalationReviewer is invalid and was ignored; ${UNTIL_FIXED}`,
      "permission-reviewer: 2 policy rule(s) in the global config are invalid and were dropped; automatic approval stays disabled until they are fixed",
      `permission-reviewer: global config enforcementMode "ENFORCE" is invalid and was ignored; ${UNTIL_FIXED}`,
      `permission-reviewer: global config escalationMode "DENY" is invalid and was ignored; ${UNTIL_FIXED}`,
    ]);
  });

  test.each([
    [
      "global",
      { global: { enforcementMode: "observe", escalationMode: "manual" } },
    ],
    [
      "global",
      { global: { enforcementMode: "enforce", escalationMode: "deny" } },
    ],
    [
      "inline",
      { inline: { enforcementMode: "observe", escalationMode: "manual" } },
    ],
    [
      "inline",
      { inline: { enforcementMode: "enforce", escalationMode: "deny" } },
    ],
  ])("valid %s modes do not degrade", (_layer, layers) => {
    const { config, warnings } = loadLayers(layers);
    expect(config.configDegraded).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test.each(["unknown", "project"] as const)(
    "%s inline options never degrade the config",
    (trust) => {
      const { config, warnings } = loadLayers({ inline: INVALID, trust });
      expect(config.configDegraded).toBeUndefined();
      expect(warnings).toEqual([]);
    },
  );

  test("only trusted inline options carry their own configDegraded", () => {
    const degraded = (trust: "trusted" | "unknown"): unknown =>
      loadLayers({ inline: { configDegraded: ["inline reason"] }, trust })
        .config.configDegraded;
    expect(degraded("trusted")).toEqual(["inline reason"]);
    expect(degraded("unknown")).toBeUndefined();
    // Degradation the loader finds replaces the inline value.
    expect(
      loadLayers({ inline: { configDegraded: ["x"], escalationMode: "?" } })
        .config.configDegraded,
    ).toEqual(['inline config escalationMode "?" is invalid and was ignored']);
  });

  test("an invalid project layer warns about dropped rules but never degrades", () => {
    const { config, warnings } = loadLayers({ project: INVALID });
    expect(config.configDegraded).toBeUndefined();
    expect(warnings).toEqual([
      "permission-reviewer: 2 policy rule(s) in the project config are invalid and were dropped",
    ]);
  });

  test("layer warnings come first, global before project", () => {
    const { config, warnings } = loadLayers({
      global: "{bad",
      project: "{bad",
    });
    expect(config.configDegraded).toEqual([
      "global config file is malformed and was ignored",
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("global.jsonc is malformed and was ignored");
    expect(warnings[1]).toContain(
      "permission-reviewer.jsonc is malformed and was ignored",
    );
  });
});

describe("config warnings reach stderr without degrading", () => {
  const INVALID_ESCALATION =
    'systemOneEscalation "on" is not "standard" or "reasoning-first"; using "standard"';
  const INVALID_DENIAL =
    'systemOneDenialReview "yes" is not a boolean; using false';
  const NOT_JEV =
    'systemOneEscalation "reasoning-first" is inactive: the reviewer model is not Jev';

  test("an invalid global routing value falls back and warns", () => {
    const { config, warnings } = loadLayers({
      global: { systemOneEscalation: "on", systemOneDenialReview: "yes" },
    });
    expect(config.systemOneEscalation).toBe("standard");
    expect(config.systemOneDenialReview).toBe(false);
    expect(config.configDegraded).toBeUndefined();
    expect(config.configWarnings).toEqual([INVALID_ESCALATION, INVALID_DENIAL]);
    expect(warnings).toEqual([
      `permission-reviewer: ${INVALID_ESCALATION}`,
      `permission-reviewer: ${INVALID_DENIAL}`,
    ]);
  });

  test("an inert global setting warns", () => {
    const { config, warnings } = loadLayers({
      global: { systemOneEscalation: "reasoning-first" },
    });
    expect(config.systemOneEscalation).toBe("reasoning-first");
    expect(config.configWarnings).toEqual([NOT_JEV]);
    expect(warnings).toEqual([`permission-reviewer: ${NOT_JEV}`]);
  });

  test("trusted inline values warn like the global file", () => {
    const { config, warnings } = loadLayers({
      inline: { systemOneDenialReview: "yes" },
    });
    expect(config.configWarnings).toEqual([INVALID_DENIAL]);
    expect(warnings).toEqual([`permission-reviewer: ${INVALID_DENIAL}`]);
  });

  test.each(["unknown", "project"] as const)(
    "%s inline options cannot set either key, so they never warn",
    (trust) => {
      const { config, warnings } = loadLayers({
        inline: {
          systemOneEscalation: "reasoning-first",
          systemOneDenialReview: "yes",
        },
        trust,
      });
      expect(config.systemOneEscalation).toBe("standard");
      expect(config.systemOneDenialReview).toBe(false);
      expect(config.configWarnings).toBeUndefined();
      expect(warnings).toEqual([]);
    },
  );

  test("degradation warnings come before config warnings", () => {
    const { config, warnings } = loadLayers({
      global: { escalationMode: "DENY", systemOneEscalation: "on" },
    });
    expect(config.configDegraded).toEqual([
      'global config escalationMode "DENY" is invalid and was ignored',
    ]);
    expect(warnings).toEqual([
      `permission-reviewer: global config escalationMode "DENY" is invalid and was ignored; ${UNTIL_FIXED}`,
      `permission-reviewer: ${INVALID_ESCALATION}`,
    ]);
  });
});
