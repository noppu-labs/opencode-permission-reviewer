import { describe, expect, test } from "bun:test";
import type { RiskPolicy } from "../src/kernel/reviewer-config.ts";
import { loadConfig } from "./config-layer-fixtures.ts";

const GLOBAL_POLICY = {
  allow: { low: ["high", "medium"], medium: ["high"] },
  onInvalidDecision: "deny",
};

function clamped(
  project: unknown,
  global: unknown = GLOBAL_POLICY,
): RiskPolicy {
  return loadConfig({
    global: { riskPolicy: global },
    project: { riskPolicy: project },
  }).riskPolicy;
}

const trustedPolicy = (): RiskPolicy =>
  loadConfig({ global: { riskPolicy: GLOBAL_POLICY } }).riskPolicy;

describe("a project riskPolicy only tightens the trusted matrix", () => {
  test.each([
    ["null", null],
    ["a string", "strict"],
    ["an array", [{ allow: {} }]],
  ])("%s is ignored", (_label, project) => {
    expect(clamped(project)).toEqual(trustedPolicy());
  });

  test("an omitted allow keeps the trusted cells; a present one intersects", () => {
    // Cells the trusted file left out are empty once the project sends a
    // policy object, instead of falling back to the builtin cells.
    expect(trustedPolicy().allow.high).toEqual(["high", "medium"]);
    expect(clamped({}).allow).toEqual({
      low: ["high", "medium"],
      medium: ["high"],
      high: [],
      critical: [],
    });
    expect(
      clamped({ allow: { low: ["medium", "unknown"], medium: "high" } }).allow,
    ).toEqual({ low: ["medium"], medium: [], high: [], critical: [] });
  });

  test("a non-object project allow counts as omitted", () => {
    const trusted = trustedPolicy().allow;
    expect(clamped({ allow: null }).allow).toEqual({ ...trusted, high: [] });
    expect(clamped({ allow: "low" }).allow).toEqual({ ...trusted, high: [] });
  });

  test("an array project allow clamps every cell to nothing", () => {
    expect(clamped({ allow: ["low"] }).allow).toEqual({
      low: [],
      medium: [],
      high: [],
      critical: [],
    });
  });

  test("a non-array trusted cell clamps to nothing", () => {
    const global = { allow: { low: "high" } };
    expect(clamped({ allow: { low: ["high"] } }, global).allow.low).toEqual([]);
  });

  test("a null trusted allow matrix clamps every cell to nothing", () => {
    expect(clamped({}, { allow: null }).allow).toEqual({
      low: [],
      medium: [],
      high: [],
      critical: [],
    });
  });

  test("a non-object trusted policy clamps against the builtin matrix", () => {
    expect(
      clamped({ allow: { low: ["high"], high: ["high"] } }, "x").allow,
    ).toEqual({ low: ["high"], medium: [], high: ["high"], critical: [] });
  });

  test("failure knobs harden to deny but never relax", () => {
    const knobs = (project: unknown, global: unknown = {}): unknown[] => {
      const policy = clamped(project, global);
      return [policy.onInvalidDecision, policy.onReviewerFailure];
    };
    expect(
      knobs({ onInvalidDecision: "deny", onReviewerFailure: "deny" }),
    ).toEqual(["deny", "deny"]);
    const trustedDeny = {
      onInvalidDecision: "deny",
      onReviewerFailure: "deny",
    };
    expect(
      ["manual", "allow", undefined].map((value) =>
        knobs(
          { onInvalidDecision: value, onReviewerFailure: value },
          trustedDeny,
        ),
      ),
    ).toEqual([
      ["deny", "deny"],
      ["deny", "deny"],
      ["deny", "deny"],
    ]);
  });

  test("minimumConfidence can be raised but not lowered", () => {
    const minimum = (project: unknown, global: unknown = {}): number =>
      clamped({ minimumConfidence: project }, { minimumConfidence: global })
        .minimumConfidence;
    expect(minimum(0.9, 0.8)).toBe(0.9);
    expect(minimum(0.6, 0.8)).toBe(0.8);
    expect(minimum("0.9", 0.8)).toBe(0.8);
    // A wrong-kind trusted value is replaced by the builtin minimum first.
    expect(minimum(0.6, "high")).toBe(0.7);
    expect(minimum(0.75, "high")).toBe(0.75);
  });

  test("a non-finite trusted minimum is replaced by the builtin one", () => {
    const minimum = (project: number): number =>
      loadConfig({
        inline: { riskPolicy: { minimumConfidence: Number.NaN } },
        project: { riskPolicy: { minimumConfidence: project } },
      }).riskPolicy.minimumConfidence;
    expect([0.6, 0.8].map(minimum)).toEqual([0.7, 0.8]);
  });

  test("a non-finite unknown-origin minimum is dropped", () => {
    const loaded = loadConfig({
      global: { riskPolicy: { minimumConfidence: 0.8 } },
      inline: { riskPolicy: { minimumConfidence: Number.NaN } },
      trust: "unknown",
    });
    expect(loaded.riskPolicy.minimumConfidence).toBe(0.8);
  });
});
