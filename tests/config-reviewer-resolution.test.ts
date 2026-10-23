import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  resolveConfig,
} from "../src/modules/config/services/config.ts";
import {
  isSystemOneReviewerModel,
  isValidEscalationReviewer,
} from "../src/modules/config/services/reviewer-model.ts";

describe("resolveConfig structured fields", () => {
  test("output keys keep their order, since the server hashes the serialized config", () => {
    const config = resolveConfig({
      escalationReviewer: { model: "openai/gpt-x" },
      reviewBudgetMs: 200_000,
      auditPath: "/tmp/audit.jsonl",
      policy: "Review carefully.",
      configDegraded: ["reason"],
      // Inert with the default model, so configWarnings is present too.
      systemOneEscalation: "reasoning-first",
    });
    expect(Object.keys(config)).toEqual([
      "model",
      "variant",
      "outputFormat",
      "escalationReviewer",
      "timeoutMs",
      "reviewBudgetMs",
      "maxContextChars",
      "maxPartChars",
      "maxEnrichmentChars",
      "maxIntentChars",
      "transcriptMessages",
      "intentMessages",
      "historyMessages",
      "confidenceThreshold",
      "systemOneConfidenceThreshold",
      "systemOneReasoningThreshold",
      "systemOneEscalation",
      "systemOneDenialReview",
      "retainReviewSessions",
      "audit",
      "auditPath",
      "policy",
      "debug",
      "enforcementMode",
      "escalationMode",
      "maxSessionDepth",
      "maxParentSessions",
      "actorProfiles",
      "riskPolicy",
      "repositoryTrust",
      "policyRules",
      "askDecisions",
      "configDegraded",
      "configWarnings",
    ]);
  });

  test("actorProfiles keeps only known profiles, keyed by name", () => {
    const profiles = (value: unknown): unknown =>
      resolveConfig({ actorProfiles: value }).actorProfiles;
    expect(profiles({ build: "operator", plan: "admin", x: 1 })).toEqual({
      build: "operator",
    });
    expect(profiles(null)).toEqual({});
    expect(profiles("operator")).toEqual({});
    // An array is an object: its indices become names.
    expect(profiles(["reviewer"])).toEqual({ "0": "reviewer" });
  });

  test("configDegraded is kept only as a non-empty string array", () => {
    const degraded = (value: unknown): unknown =>
      resolveConfig({ configDegraded: value }).configDegraded;
    expect(degraded(["a", "b"])).toEqual(["a", "b"]);
    expect(degraded([])).toBeUndefined();
    expect(degraded(["a", 1])).toBeUndefined();
    expect(degraded("a")).toBeUndefined();
  });
});

describe("escalation reviewer", () => {
  const reviewer = (value: unknown): unknown =>
    resolveConfig({ escalationReviewer: value }).escalationReviewer;

  test("resolution fills defaults and rejects non-reasoning reviewers", () => {
    expect(
      reviewer({ model: "a/b", variant: "", outputFormat: "TEXT" }),
    ).toEqual({
      model: "a/b",
      variant: DEFAULT_CONFIG.variant,
      outputFormat: "json_schema",
      timeoutMs: DEFAULT_CONFIG.timeoutMs,
    });
    expect(
      reviewer({
        model: "a/b",
        variant: "low",
        outputFormat: "text",
        timeoutMs: 1,
      }),
    ).toEqual({
      model: "a/b",
      variant: "low",
      outputFormat: "text",
      timeoutMs: 5_000,
    });
    const rejected = [
      { model: "no-slash" },
      { model: "opencode/jev" },
      { model: 5 },
      Object.assign(["x"], { model: "a/b" }),
      null,
      "a/b",
    ];
    expect(rejected.map(reviewer)).toEqual(rejected.map(() => undefined));
  });

  test.each([
    [{ model: "a/b" }, true],
    [
      { model: "a/b", variant: "low", outputFormat: "text", timeoutMs: 9 },
      true,
    ],
    [{ model: "a/b", outputFormat: "json_schema" }, true],
    [{ model: "no-slash" }, false],
    [{ model: "opencode/jev-2" }, false],
    [{ model: "a/b", variant: "" }, false],
    [{ model: "a/b", variant: 5 }, false],
    [{ model: "a/b", outputFormat: "TEXT" }, false],
    [{ model: "a/b", timeoutMs: 1.5 }, false],
    [{ model: "a/b", timeoutMs: "9" }, false],
    [Object.assign(["x"], { model: "a/b" }), false],
    [null, false],
  ])("isValidEscalationReviewer(%j) is %p", (value, valid) => {
    expect(isValidEscalationReviewer(value)).toBe(valid);
  });

  test("a model id splitModel rejects is never a System One model", () => {
    expect(
      ["no-slash", "/jev", "opencode/"].map(isSystemOneReviewerModel),
    ).toEqual([false, false, false]);
    expect(isSystemOneReviewerModel("typesafe-ai/jev")).toBe(true);
  });
});
