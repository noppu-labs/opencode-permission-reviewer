import { describe, expect, test } from "bun:test";
import { countInvalidPolicyRules } from "../src/modules/config/models/config-policy-rules.ts";
import { resolveConfig } from "../src/modules/config/services/config.ts";

const RULE = { id: "r1", source: "global", effect: "deny", reason: "why" };

function rules(value: unknown): unknown {
  return resolveConfig({ policyRules: value }).policyRules;
}

describe("policy rule parsing", () => {
  test("a valid rule keeps its fields and its validated condition", () => {
    const when = { actorProfile: ["operator"], deletion: true };
    expect(rules([{ ...RULE, when }])).toEqual([{ ...RULE, when }]);
    expect(rules([RULE])).toEqual([RULE]);
    expect(countInvalidPolicyRules([RULE, { ...RULE, when }])).toBe(0);
  });

  test.each([
    ["null entry", null],
    ["missing id", { ...RULE, id: undefined }],
    ["empty id", { ...RULE, id: "" }],
    ["numeric id", { ...RULE, id: 7 }],
    ["unknown source", { ...RULE, source: "remote" }],
    ["unknown effect", { ...RULE, effect: "block" }],
    ["empty reason", { ...RULE, reason: "" }],
    ["null when", { ...RULE, when: null }],
    ["string when", { ...RULE, when: "always" }],
  ])("%s drops the rule", (_label, rule) => {
    expect(rules([rule, RULE])).toEqual([RULE]);
    expect(countInvalidPolicyRules([rule, RULE])).toBe(1);
  });

  test("a non-array rule list resolves to no rules and counts as one invalid entry", () => {
    expect(rules({ 0: RULE })).toEqual([]);
    expect(countInvalidPolicyRules({ 0: RULE })).toBe(1);
    expect(countInvalidPolicyRules(undefined)).toBe(0);
  });
});

describe("policy condition validation", () => {
  test.each([
    ["unknown key", { deletion: true, delete: true }],
    ["always false", { always: false }],
    ["always with another key", { always: true, deletion: true }],
    ["flag set to false", { deletion: false }],
    ["flag of the wrong type", { deletion: "yes" }],
    ["empty list", { actionClass: [] }],
    ["list member outside the closed set", { actorProfile: ["admin"] }],
    ["non-string list member", { repositoryTrust: [1] }],
    ["empty condition", {}],
  ])("%s drops the rule", (_label, when) => {
    expect(rules([{ ...RULE, when }])).toEqual([]);
  });

  test("every list condition and flag is copied in a fixed order", () => {
    const when = {
      persistence: true,
      repositoryTrust: ["untrusted"],
      actorProfile: ["workspace"],
      actionClass: ["network"],
      credentialRead: true,
    };
    const [rule] = rules([{ ...RULE, when }]) as [{ when: object }];
    expect(rule.when).toEqual(when);
    expect(Object.keys(rule.when)).toEqual([
      "actionClass",
      "actorProfile",
      "repositoryTrust",
      "credentialRead",
      "persistence",
    ]);
    expect(rules([{ ...RULE, when: { always: true } }])).toEqual([
      { ...RULE, when: { always: true } },
    ]);
  });
});

describe("risk policy resolution", () => {
  const risk = (value: unknown): unknown =>
    resolveConfig({ riskPolicy: value }).riskPolicy;
  const defaults = resolveConfig({}).riskPolicy;

  test("a non-object policy or allow matrix keeps the defaults", () => {
    expect(risk(null)).toEqual(defaults);
    expect(risk({ allow: null })).toEqual(defaults);
    expect(risk({ allow: { low: "high" } })).toEqual(defaults);
  });

  test("allow cells keep only known authorization levels", () => {
    expect(
      (risk({ allow: { high: ["high", "root", 1] } }) as typeof defaults).allow,
    ).toEqual({ ...defaults.allow, high: ["high"] });
  });

  test("minimumConfidence is clamped to [0.5, 1] and must be finite", () => {
    const min = (value: unknown): unknown =>
      (risk({ minimumConfidence: value }) as typeof defaults).minimumConfidence;
    expect(min(0.1)).toBe(0.5);
    expect(min(2)).toBe(1);
    expect(min(0.8)).toBe(0.8);
    expect(min(Number.NaN)).toBe(defaults.minimumConfidence);
    expect(min(Infinity)).toBe(defaults.minimumConfidence);
  });
});
