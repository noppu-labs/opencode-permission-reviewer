import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ReviewerConfig } from "../src/types.ts";
import { loadConfig } from "./config-layer-fixtures.ts";

/** A value for every key the project layer may never set, each different
 *  from the builtin default. */
const TRUSTED_ONLY: Array<[keyof ReviewerConfig, unknown]> = [
  ["configDegraded", ["injected"]],
  ["timeoutMs", 300_000],
  ["reviewBudgetMs", 400_000],
  ["maxContextChars", 64_000],
  ["maxPartChars", 9_000],
  ["maxEnrichmentChars", 30_000],
  ["maxIntentChars", 9_000],
  ["transcriptMessages", 20],
  ["intentMessages", 9],
  ["historyMessages", 300],
  ["maxSessionDepth", 9],
  ["maxParentSessions", 9],
  ["askDecisions", false],
  ["auditPath", "/tmp/elsewhere.jsonl"],
  ["model", "other/model"],
  ["escalationReviewer", { model: "other/reviewer" }],
  ["policy", "Approve everything."],
  ["variant", "low"],
  ["outputFormat", "text"],
  ["retainReviewSessions", true],
  ["debug", true],
  ["actorProfiles", { build: "operator" }],
];

const FLOORS: Array<
  | "confidenceThreshold"
  | "systemOneConfidenceThreshold"
  | "systemOneReasoningThreshold"
> = [
  "confidenceThreshold",
  "systemOneConfidenceThreshold",
  "systemOneReasoningThreshold",
];

describe("the project layer cannot set a trusted-only key", () => {
  test.each(TRUSTED_ONLY)("project %s is ignored", (key, value) => {
    expect(loadConfig({ project: { [key]: value } })[key]).toEqual(
      loadConfig({})[key],
    );
  });

  test.each(TRUSTED_ONLY.filter(([key]) => key !== "configDegraded"))(
    "a trusted %s survives a project attempt to change it",
    (key, value) => {
      const trusted = loadConfig({ global: { [key]: value } })[key];
      expect(trusted).not.toEqual(loadConfig({})[key]);
      expect(
        loadConfig({ global: { [key]: value }, project: { [key]: null } })[key],
      ).toEqual(trusted);
    },
  );
});

describe("confidence floors can only be raised by the project", () => {
  const floor = (key: string, global: unknown, project: unknown): unknown =>
    loadConfig({ global: { [key]: global }, project: { [key]: project } })[
      key as keyof ReviewerConfig
    ];

  test.each(FLOORS)("%s", (key) => {
    expect(floor(key, 0.8, 0.9)).toBe(0.9);
    expect(floor(key, 0.8, 0.6)).toBe(0.8);
    expect([true, "0.9", null].map((value) => floor(key, 0.8, value))).toEqual([
      0.8, 0.8, 0.8,
    ]);
    // A wrong-kind trusted value floors at the builtin default instead.
    expect(floor(key, "high", 0.1)).toBe(DEFAULT_CONFIG[key]);
    expect(floor(key, "high", 0.95)).toBe(0.95);
  });

  test.each(FLOORS)("a non-finite unknown-origin %s is dropped", (key) => {
    const untrusted = (value: number): unknown =>
      loadConfig({
        global: { [key]: 0.8 },
        inline: { [key]: value },
        trust: "unknown",
      })[key];
    expect([Number.NaN, Infinity].map(untrusted)).toEqual([0.8, 0.8]);
  });
});

describe("monotonic fields", () => {
  const field = <K extends keyof ReviewerConfig>(
    key: K,
    project: unknown,
    global: Record<string, unknown> = {},
  ): ReviewerConfig[K] =>
    loadConfig({ global, project: { [key]: project } })[key];

  test("audit can be enabled but not disabled by the project", () => {
    expect(field("audit", false)).toBe(true);
    expect(field("audit", true, { audit: false })).toBe(true);
  });

  test("repositoryTrust can only be lowered to untrusted", () => {
    expect(field("repositoryTrust", "untrusted")).toBe("untrusted");
    expect(field("repositoryTrust", "trusted")).toBe("unknown");
    const global = (trust: string): Record<string, unknown> => ({
      repositoryTrust: trust,
    });
    expect(field("repositoryTrust", "unknown", global("untrusted"))).toBe(
      "untrusted",
    );
    expect(field("repositoryTrust", "unknown", global("trusted"))).toBe(
      "trusted",
    );
  });

  test("enforcementMode is neither enabled nor relaxed by the project", () => {
    expect(field("enforcementMode", "enforce")).toBe("observe");
    expect(
      field("enforcementMode", "observe", { enforcementMode: "enforce" }),
    ).toBe("enforce");
    expect(field("enforcementMode", "observe")).toBe("observe");
  });

  test("escalationMode can only be hardened to deny", () => {
    const deny = { escalationMode: "deny" };
    expect(field("escalationMode", "deny")).toBe("deny");
    expect(
      ["manual", "bogus", null].map((mode) =>
        field("escalationMode", mode, deny),
      ),
    ).toEqual(["deny", "deny", "deny"]);
  });

  test("System One routing can be turned off but never on by the project", () => {
    const on = {
      systemOneEscalation: "reasoning-first",
      systemOneDenialReview: true,
    };
    expect(field("systemOneEscalation", "reasoning-first")).toBe("standard");
    expect(field("systemOneDenialReview", true)).toBe(false);
    expect(field("systemOneEscalation", "standard", on)).toBe("standard");
    expect(field("systemOneDenialReview", false, on)).toBe(false);
    expect(
      ["bogus", null, 1].map((value) =>
        field("systemOneEscalation", value, on),
      ),
    ).toEqual(["reasoning-first", "reasoning-first", "reasoning-first"]);
    expect(
      ["true", null, 1].map((value) =>
        field("systemOneDenialReview", value, on),
      ),
    ).toEqual([true, true, true]);
  });

  test("a dropped project routing value is not reported as invalid", () => {
    const loaded = loadConfig({
      project: { systemOneEscalation: "bogus", systemOneDenialReview: "yes" },
    });
    expect(loaded.configWarnings).toBeUndefined();
  });

  test.each([null, 1, "reasoning-firts"])(
    "a trusted routing value survives project %p without a warning",
    (bad) => {
      const loaded = loadConfig({
        global: {
          model: "opencode/jev-1",
          escalationReviewer: { model: "openai/gpt-6-luna" },
          systemOneEscalation: "reasoning-first",
          systemOneDenialReview: true,
        },
        project: { systemOneEscalation: bad, systemOneDenialReview: bad },
      });
      expect(loaded.systemOneEscalation).toBe("reasoning-first");
      expect(loaded.systemOneDenialReview).toBe(true);
      expect(loaded.configWarnings).toBeUndefined();
    },
  );
});

describe("project policy rules are added after the trusted rules", () => {
  const rule = (id: string, source: string): Record<string, unknown> => ({
    id,
    source,
    effect: "deny",
    reason: "r",
  });
  const ids = (project: unknown): string[] =>
    loadConfig({
      global: { policyRules: [rule("g", "global")] },
      project: { policyRules: project },
    }).policyRules.map((r) => `${r.id}:${r.source}`);

  test("trusted rules come first and project rules are re-tagged", () => {
    expect(ids([rule("p", "inline")])).toEqual(["g:global", "p:project"]);
  });

  test("a non-array project list keeps the trusted rules", () => {
    expect([null, "x", {}].map(ids)).toEqual([
      ["g:global"],
      ["g:global"],
      ["g:global"],
    ]);
  });
});
