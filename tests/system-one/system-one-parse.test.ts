import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../../src/config.ts";
import {
  enforceParsedSystemOneReview,
  enforceSystemOneDecision,
  parseSystemOneReview,
  SYSTEM_ONE_QUESTIONS,
} from "../../src/system-one/review.ts";
import { defined } from "../helpers.ts";
import { choice, PRIMARY_BASES, response } from "./system-one-fixtures.ts";

describe("System One reviewer", () => {
  test("builds a complete fixed question set", () => {
    expect(Object.keys(SYSTEM_ONE_QUESTIONS)).toHaveLength(15);
    expect(SYSTEM_ONE_QUESTIONS.outcome.type).toBe("choice");
    expect(SYSTEM_ONE_QUESTIONS.absolute_policy_deny.type).toBe("noul");
  });

  test("accepts a confident and internally consistent allow", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const parsed = parseSystemOneReview(response(), config);
    expect(parsed?.difficultReason).toBeUndefined();
    expect(parsed?.decision).toMatchObject({
      outcome: "allow",
      risk_level: "low",
      confidence: 1,
      rationale: "The action is routine, narrow, and adequately authorized.",
    });
  });

  test("exposes Jev's own scores without any evidence text", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const outcome = choice("escalate", ["allow", "deny", "escalate"], 0.6);
    const parsed = parseSystemOneReview(
      response({
        outcome,
        risk_level: choice("low", ["low", "medium", "high", "critical"], 0.8),
        within_intent_scope: { type: "noul", noul: 0.8 },
        unauthorized_external_mutation: { type: "noul", noul: 0.15 },
        absolute_policy_deny: { type: "noul", noul: 0.75 },
      }),
      config,
    );
    expect(parsed?.scores).toEqual({
      returnedModel: "jev-1.13.0",
      outcome: {
        choice: "escalate",
        confidence: 0.6,
        probabilities: { allow: 0.2, deny: 0.2, escalate: 0.6 },
      },
      supporting: {
        riskLevel: { choice: "low", confidence: 0.8 },
        userAuthorization: { choice: "high", confidence: 1 },
        scopeAlignment: { choice: "aligned", confidence: 1 },
        evidenceCompleteness: { choice: "sufficient", confidence: 1 },
        primaryBasis: { choice: "authorized_routine", confidence: 1 },
      },
      signals: {
        materialAuthorization: 1,
        withinIntentScope: 0.8,
        unauthorizedDataLoss: 0,
        untrustedSensitiveDisclosure: 0,
        excessiveCredentialAccess: 0,
        unauthorizedSecurityChange: 0,
        unauthorizedExternalMutation: 0.15,
        essentialEvidenceMissing: 0,
        absolutePolicyDeny: 0.75,
      },
      contradictions: [
        "the disposition conflicts with an absolute policy-deny signal",
      ],
      reasoningRecommended: true,
    });
  });

  test("escalates a low-confidence deny instead of trusting it", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const parsed = parseSystemOneReview(
      response({
        outcome: choice("deny", ["allow", "deny", "escalate"], 0.35),
        risk_level: choice("high", ["low", "medium", "high", "critical"]),
        primary_basis: choice("destructive_effect", PRIMARY_BASES),
        unauthorized_data_loss: { type: "noul", noul: 1 },
      }),
      config,
    );
    expect(parsed?.decision.outcome).toBe("deny");
    expect(parsed?.difficultReason).toContain("below 0.40");
  });

  test("uses outcome confidence instead of the weakest descriptive field", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const parsed = parseSystemOneReview(
      response({
        evidence_completeness: choice(
          "sufficient",
          ["sufficient", "partial", "insufficient", "unknown"],
          0.31,
        ),
      }),
      config,
    );
    expect(parsed?.decision.confidence).toBe(1);
    expect(parsed?.difficultReason).toBeUndefined();
  });

  test("requires strong outcome confidence to allow with incomplete evidence", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const parsed = parseSystemOneReview(
      response({
        outcome: choice("allow", ["allow", "deny", "escalate"], 0.62),
        evidence_completeness: choice("partial", [
          "sufficient",
          "partial",
          "insufficient",
          "unknown",
        ]),
      }),
      config,
    );
    expect(parsed?.difficultReason).toContain("incomplete evidence");
  });

  test("recommends reasoning only when an explicit escalation is plausibly resolvable", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const strict = resolveConfig({
      model: "opencode/jev-1.13-free",
      systemOneReasoningThreshold: 0.5,
    });
    const clear = parseSystemOneReview(
      response({ outcome: choice("escalate", ["allow", "deny", "escalate"]) }),
      config,
    );
    const ambiguous = parseSystemOneReview(
      response({
        outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
      }),
      config,
    );
    expect(clear?.reasoningRecommended).toBe(false);
    expect(ambiguous?.reasoningRecommended).toBe(true);
    expect(
      parseSystemOneReview(
        response({
          outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
        }),
        strict,
      )?.reasoningRecommended,
    ).toBe(false);
  });

  test("preserves a valid deny even when its confidence marks it difficult", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const parsed = parseSystemOneReview(
      response({
        outcome: choice("deny", ["allow", "deny", "escalate"], 0.35),
        risk_level: choice("high", ["low", "medium", "high", "critical"]),
        primary_basis: choice("destructive_effect", PRIMARY_BASES),
      }),
      config,
    );
    expect(parsed?.difficultReason).toContain("below 0.40");
    expect(
      enforceParsedSystemOneReview(defined(parsed, "parsed review"), config)
        .kind,
    ).toBe("deny");
  });

  test("does not reapply chat-model confidence floors after reconciliation", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const parsed = parseSystemOneReview(
      response({
        outcome: choice("allow", ["allow", "deny", "escalate"], 0.55),
      }),
      config,
    );
    expect(parsed?.difficultReason).toBeUndefined();
    expect(
      enforceSystemOneDecision(
        defined(parsed, "parsed review").decision,
        config,
      ).kind,
    ).toBe("allow");
  });

  test("treats an unsafe allow signal as a difficult contradiction", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const parsed = parseSystemOneReview(
      response({
        untrusted_sensitive_disclosure: { type: "noul", noul: 0.85 },
      }),
      config,
    );
    expect(parsed?.difficultReason).toContain("material safety signal");
  });

  test("rejects a choice that is not the most probable option", () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const raw = response();
    raw.answers.outcome = {
      type: "choice",
      choice: "allow",
      confidence: 0.6,
      probabilities: { allow: 0.05, deny: 0.9, escalate: 0.05 },
    };
    expect(parseSystemOneReview(raw, config)).toBeUndefined();
  });
});
