import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  loadResolvedConfig,
  setGlobalConfigPathForTests,
} from "../../src/config/loader.ts";
import { resolveConfig } from "../../src/config.ts";
import { enforceDecision } from "../../src/decision.ts";
import { evaluatePolicy } from "../../src/policy/policy-engine.ts";
import { defined, MockClient, request, runtime } from "../helpers.ts";
import {
  captureWarnings,
  expectModelAllowBlocked,
  isolateGlobal,
  loadTrustedRules,
  tempDir,
  useGlobalConfig,
  writeProjectConfig,
} from "./trust-fixtures.ts";

afterEach(() => {
  setGlobalConfigPathForTests(undefined);
});

// --- rule condition validation --------------------------------------------------

describe("trust hardening — rule condition validation", () => {
  test.each([
    [
      "an unknown when-key (typo) drops the rule instead of making it universal",
      { id: "typo-deny", effect: "deny", reason: "typo" },
      { netwrkObserved: true },
      0,
    ],
    [
      "a false flag condition drops the rule (facts are never false)",
      { id: "no-code", effect: "deny", reason: "no code" },
      { executesCode: false },
      0,
    ],
    [
      "credentialRead:true is accepted as a policy condition",
      { id: "cred", effect: "manual", reason: "cred" },
      { credentialRead: true },
      1,
    ],
    [
      "credentialRead:false drops the rule (facts are never false)",
      { id: "cred", effect: "manual", reason: "cred" },
      { credentialRead: false },
      0,
    ],
    [
      "a misspelled credential condition key drops the rule",
      { id: "cred", effect: "manual", reason: "cred" },
      { credentialReads: true },
      0,
    ],
    [
      "an empty when object drops the rule; catch-alls are expressed by omitting when",
      { id: "catch-all", effect: "deny", reason: "all" },
      {},
      0,
    ],
  ] as const)("%s", (_title, rule, when, kept) => {
    const config = resolveConfig({
      policyRules: [
        {
          id: rule.id,
          source: "global",
          effect: rule.effect,
          reason: rule.reason,
          when,
        },
      ],
    });
    expect(config.policyRules).toHaveLength(kept);
  });

  test("effectivePolicyHash changes with the decision-relevant config", () => {
    const rules = [
      {
        id: "r1",
        source: "global" as const,
        when: { executesCode: true },
        effect: "manual" as const,
        reason: "code",
      },
    ];
    const lo = evaluatePolicy(
      undefined,
      undefined,
      resolveConfig({ confidenceThreshold: 0.7 }),
      rules,
    );
    const hi = evaluatePolicy(
      undefined,
      undefined,
      resolveConfig({ confidenceThreshold: 0.95 }),
      rules,
    );
    expect(lo.effectivePolicyHash).not.toBe(hi.effectivePolicyHash);
  });
});

// --- decision threshold ---------------------------------------------------------

describe("trust hardening — riskPolicy.minimumConfidence is enforced", () => {
  test("an allow below minimumConfidence escalates even above confidenceThreshold", () => {
    const config = resolveConfig({
      confidenceThreshold: 0.7,
      riskPolicy: { minimumConfidence: 0.95 },
    });
    const result = enforceDecision(
      {
        version: 2,
        outcome: "allow",
        risk_level: "low",
        user_authorization: "high",
        rationale: "Narrow, reversible, user-requested action.",
        confidence: 0.8,
        scope_alignment: "aligned",
        evidence_completeness: "sufficient",
      },
      config,
    );
    expect(result.kind).toBe("escalate");
  });
});

// --- universal rules and degraded trusted config ----------------------------------------

describe("trust hardening — universal rules and fail-closed trusted config", () => {
  test("omitting when (or always:true) makes a rule universal and it matches everything", () => {
    const omitted = resolveConfig({
      policyRules: [
        {
          id: "catch-all",
          source: "global",
          effect: "deny",
          reason: "everything",
        },
      ],
    });
    expect(omitted.policyRules).toHaveLength(1);
    expect(defined(omitted.policyRules[0], "policy rule").when).toBeUndefined();
    const trace = evaluatePolicy(
      undefined,
      undefined,
      omitted,
      omitted.policyRules,
    );
    expect(trace.finalRoute).toBe("deny");

    const explicit = resolveConfig({
      policyRules: [
        {
          id: "catch-all-2",
          source: "global",
          effect: "manual",
          reason: "everything",
          when: { always: true },
        },
      ],
    });
    expect(explicit.policyRules).toHaveLength(1);
    expect(
      evaluatePolicy(undefined, undefined, explicit, explicit.policyRules)
        .finalRoute,
    ).toBe("manual");

    // `always` combined with other keys is contradictory and rejected.
    const mixed = resolveConfig({
      policyRules: [
        {
          id: "mixed",
          source: "global",
          effect: "deny",
          reason: "mixed",
          when: { always: true, deletion: true },
        },
      ],
    });
    expect(mixed.policyRules).toHaveLength(0);
  });

  test("a malformed global config degrades the config and blocks automatic approval", async () => {
    const dir = tempDir("reviewer-globalcfg-");
    try {
      useGlobalConfig(dir, "{ confidenceThreshold: "); // unterminated
      const config = loadResolvedConfig({ confidenceThreshold: 0.9 });
      expect(config.configDegraded).toBeDefined();
      expect(
        defined(config.configDegraded, "configDegraded").join(" "),
      ).toContain("malformed");

      // An LLM allow under a degraded config must not auto-approve.
      const client = new MockClient();
      const harness = runtime(client, config);
      const result = await harness.runtime.process(request());
      expect(result.kind).toBe("escalate");
      expect(result.reason).toContain("degraded");
      expect(client.replies).toHaveLength(0);
    } finally {
      setGlobalConfigPathForTests(undefined);
      rmSync(dir, { recursive: true });
    }
  });

  test("invalid trusted policy rules degrade the config instead of silently vanishing", () => {
    const dir = tempDir("reviewer-globalrules-");
    try {
      useGlobalConfig(dir, {
        policyRules: [
          {
            id: "typo",
            source: "global",
            effect: "deny",
            reason: "typo",
            when: { netwrk: true },
          },
        ],
      });
      const config = loadResolvedConfig({});
      expect(config.configDegraded).toBeDefined();
      expect(
        defined(config.configDegraded, "configDegraded").join(" "),
      ).toContain("dropped by validation");
      // The dropped deny rule did not survive as a rule…
      expect(config.policyRules).toHaveLength(0);
      // …and the degradation enters the effective-policy identity.
      setGlobalConfigPathForTests(undefined);
      const clean = loadResolvedConfig({});
      expect(
        evaluatePolicy(undefined, undefined, config, []).effectivePolicyHash,
      ).not.toBe(
        evaluatePolicy(undefined, undefined, clean, []).effectivePolicyHash,
      );
    } finally {
      setGlobalConfigPathForTests(undefined);
      rmSync(dir, { recursive: true });
    }
  });

  test("an unreadable global config (not missing) degrades the config", () => {
    // A directory at the config path: exists, but cannot be read as a file.
    const dir = tempDir("reviewer-globaldir-");
    try {
      setGlobalConfigPathForTests(dir);
      const config = loadResolvedConfig({});
      expect(config.configDegraded).toBeDefined();
      expect(
        defined(config.configDegraded, "configDegraded").join(" "),
      ).toContain("could not be read");
    } finally {
      setGlobalConfigPathForTests(undefined);
      rmSync(dir, { recursive: true });
    }
  });
});

// --- condition enum validation fails closed -------------------------------------

describe("trust hardening - condition enum typos fail closed", () => {
  const badConditions: Array<[string, Record<string, unknown>]> = [
    ["repositoryTrust", { repositoryTrust: ["untrustd"] }],
    ["actorProfile", { actorProfile: ["opeator"] }],
    ["actionClass", { actionClass: ["netwrk"] }],
  ];

  for (const layer of ["global", "inline"] as const) {
    for (const [name, when] of badConditions) {
      test(`misspelled trusted ${layer} ${name} drops the rule and blocks model allow`, async () => {
        const dir = tempDir("reviewer-enum-");
        try {
          const rule = {
            id: `bad-${name}`,
            source: layer,
            effect: "deny",
            reason: "enum typo",
            when,
          };
          const config = loadTrustedRules(dir, layer, [rule]);
          expect(config.configDegraded?.length).toBeGreaterThan(0);
          expect(config.policyRules).toHaveLength(0);
          await expectModelAllowBlocked(config);
        } finally {
          setGlobalConfigPathForTests(undefined);
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }

  for (const layer of ["global", "inline"] as const) {
    for (const when of [{ repositoryTrust: [] }, { actionClass: [] }]) {
      test(`empty trusted ${layer} list ${JSON.stringify(when)} drops the rule and degrades`, () => {
        const dir = tempDir("reviewer-enum-empty-");
        try {
          const rule = {
            id: "empty-list",
            source: layer,
            effect: "deny",
            reason: "empty list",
            when,
          };
          const config = loadTrustedRules(dir, layer, [rule]);
          expect(config.configDegraded?.length).toBeGreaterThan(0);
          expect(config.policyRules).toHaveLength(0);
        } finally {
          setGlobalConfigPathForTests(undefined);
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }

  test("valid enum members and modes survive without degradation", () => {
    const dir = tempDir("reviewer-enum-valid-");
    try {
      useGlobalConfig(dir, {
        enforcementMode: "enforce",
        escalationMode: "deny",
        policyRules: [
          {
            id: "valid",
            source: "global",
            effect: "deny",
            reason: "valid members",
            when: {
              repositoryTrust: ["untrusted"],
              actionClass: ["network"],
              actorProfile: ["operator"],
            },
          },
        ],
      });
      const config = loadResolvedConfig({});
      expect(config.configDegraded).toBeUndefined();
      expect(config.policyRules).toHaveLength(1);
      expect(config.enforcementMode).toBe("enforce");
      expect(config.escalationMode).toBe("deny");
    } finally {
      setGlobalConfigPathForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a mistyped global enforcementMode degrades and blocks model allow", async () => {
    const dir = tempDir("reviewer-enum-mode-");
    try {
      useGlobalConfig(dir, { enforcementMode: "enfroce" });
      const config = loadResolvedConfig({});
      expect(
        defined(config.configDegraded, "configDegraded").join(" "),
      ).toContain("enforcementMode");
      expect(config.enforcementMode).toBe("observe");
      await expectModelAllowBlocked(config);
    } finally {
      setGlobalConfigPathForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a mistyped trusted inline enforcementMode degrades without changing the safe default", () => {
    const dir = tempDir("reviewer-enum-inline-mode-");
    try {
      isolateGlobal(dir);
      const config = loadResolvedConfig({ enforcementMode: "enfroce" });
      expect(
        defined(config.configDegraded, "configDegraded").join(" "),
      ).toContain("enforcementMode");
      expect(config.enforcementMode).toBe("observe");
    } finally {
      setGlobalConfigPathForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a mistyped global escalationMode degrades the config", () => {
    const dir = tempDir("reviewer-enum-escalation-");
    try {
      useGlobalConfig(dir, { escalationMode: "dnye" });
      const config = loadResolvedConfig({});
      expect(
        defined(config.configDegraded, "configDegraded").join(" "),
      ).toContain("escalationMode");
      expect(config.escalationMode).toBe("manual");
    } finally {
      setGlobalConfigPathForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a misspelled project rule member is dropped with a warning and no degradation", () => {
    const projectDir = tempDir("reviewer-enum-project-");
    const outsideDir = tempDir("reviewer-enum-outside-");
    const { warnings, restore } = captureWarnings();
    try {
      isolateGlobal(outsideDir);
      writeProjectConfig(projectDir, {
        policyRules: [
          {
            id: "project-typo",
            source: "project",
            effect: "deny",
            reason: "project typo",
            when: { repositoryTrust: ["untrustd"] },
          },
        ],
      });
      const config = loadResolvedConfig(undefined, projectDir);
      expect(config.policyRules).toHaveLength(0);
      expect(config.configDegraded).toBeUndefined();
      expect(
        warnings.some((w) => w.includes("project") && w.includes("dropped")),
      ).toBe(true);
    } finally {
      restore();
      setGlobalConfigPathForTests(undefined);
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
