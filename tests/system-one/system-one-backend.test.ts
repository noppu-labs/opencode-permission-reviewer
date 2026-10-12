import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../../src/config.ts";
import { ReviewAttempt } from "../../src/core/review-attempt.ts";
import { evaluateReview } from "../../src/core/review-engine.ts";
import { SystemOneReviewerBackend } from "../../src/system-one/backend.ts";
import type {
  ReviewEnvelope,
  ReviewExecutionResult,
  ReviewerConfig,
} from "../../src/types.ts";
import { defined } from "../helpers.ts";
import {
  choice,
  envelope,
  PRIMARY_BASES,
  response,
  reviewOnce,
} from "./system-one-fixtures.ts";

function reasoningAllow(
  evidence: "sufficient" | "partial",
  rationale: string,
): ReviewExecutionResult {
  return {
    kind: "allow",
    reason: rationale,
    decisionSource: "llm-reviewer",
    reviewerOutcome: "allow",
    decision: {
      version: 2,
      outcome: "allow",
      risk_level: "low",
      user_authorization: "high",
      scope_alignment: "aligned",
      evidence_completeness: evidence,
      rationale,
      confidence: 0.95,
    },
  };
}

// An explicit Jev escalation at 0.6 is plausible enough to hand to reasoning.
function escalatingJevBackend(
  config: ReviewerConfig,
  reasoning: ReviewExecutionResult,
): SystemOneReviewerBackend {
  return new SystemOneReviewerBackend(
    config,
    async () => reasoning,
    "openai/gpt-5.6-luna",
    async () =>
      response({
        outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
      }),
  );
}

// Incomplete action evidence makes the engine's allow gate downgrade any allow.
function reviewWithIncompleteEvidence(
  config: ReviewerConfig,
  backend: SystemOneReviewerBackend,
): Promise<ReviewExecutionResult> {
  const pending = envelope();
  return evaluateReview(pending.request, config, {
    collect: async () => ({ ...pending, actionEvidenceComplete: false }),
    review: (value: ReviewEnvelope) =>
      backend.review(value, new ReviewAttempt("generation", 10_000)),
    active: () => true,
    auxiliarySession: () => false,
    observe: () => {},
  });
}

describe("System One reviewer", () => {
  test("routes a valid difficult decision to the configured reasoning reviewer", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    let escalations = 0;
    const secondary: ReviewExecutionResult = {
      kind: "deny",
      reason: "Reasoning reviewer denied the action.",
      decisionSource: "llm-reviewer",
    };
    const backend = new SystemOneReviewerBackend(
      config,
      async () => {
        escalations++;
        return secondary;
      },
      "openai/gpt-5.6-luna",
      async () =>
        response({
          outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
        }),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("deny");
    expect(result.reviewerModel).toBe("openai/gpt-5.6-luna");
    expect(result.reviewerEscalatedFrom?.model).toBe("opencode/jev-1.13-free");
    expect(escalations).toBe(1);
    // Jev's scores go in `systemOne`; `reviewerEscalatedFrom` keeps only model and reason.
    expect(
      Object.keys(
        defined(result.reviewerEscalatedFrom, "reviewerEscalatedFrom"),
      ).sort(),
    ).toEqual(["model", "reason"]);
    expect(result.systemOne).toMatchObject({
      returnedModel: "jev-1.13.0",
      outcome: {
        choice: "escalate",
        confidence: 0.6,
        probabilities: choice("escalate", ["allow", "deny", "escalate"], 0.6)
          .probabilities,
      },
      reasoningRecommended: true,
    });
  });

  test("records Jev's scores on a Jev-only allow without evidence text", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const backend = new SystemOneReviewerBackend(
      config,
      undefined,
      undefined,
      async () => response(),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("allow");
    expect(result.decisionSource).toBe("system-one-reviewer");
    expect(result.systemOne).toMatchObject({
      returnedModel: "jev-1.13.0",
      outcome: { choice: "allow", confidence: 1 },
      supporting: { riskLevel: { choice: "low", confidence: 1 } },
      signals: { materialAuthorization: 1, absolutePolicyDeny: 0 },
      contradictions: [],
      reasoningRecommended: false,
    });
    const serialized = JSON.stringify(result.systemOne);
    expect(serialized).not.toContain("printf");
    expect(serialized).not.toContain("harmless marker");
  });

  test("records Jev's scores when the escalate disposition denies", async () => {
    const config = resolveConfig({
      model: "opencode/jev-1.13-free",
      escalationMode: "deny",
    });
    const backend = new SystemOneReviewerBackend(
      config,
      undefined,
      undefined,
      async () =>
        response({
          outcome: choice("escalate", ["allow", "deny", "escalate"]),
        }),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("deny");
    expect(result.escalationDisposition).toBe("deny");
    expect(result.systemOne?.outcome).toMatchObject({
      choice: "escalate",
      confidence: 1,
    });
  });

  test("records no scores when Jev returns an invalid decision", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const backend = new SystemOneReviewerBackend(
      config,
      undefined,
      undefined,
      async () => ({
        ...response(),
        model: "not-jev",
      }),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("escalate");
    expect(result.decisionSource).toBe("failure-safe");
    expect(result.systemOne).toBeUndefined();
  });

  test("records a reasoning reviewer failure against that reviewer and keeps Jev's scores", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const backend = new SystemOneReviewerBackend(
      config,
      async () => {
        throw new Error("shutting down");
      },
      "openai/gpt-5.6-luna",
      async () =>
        response({
          outcome: choice("escalate", ["allow", "deny", "escalate"], 0.6),
        }),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("escalate");
    expect(result.decisionSource).toBe("failure-safe");
    expect(result.systemOne?.outcome.choice).toBe("escalate");
    expect(result.reviewerModel).toBe("openai/gpt-5.6-luna");
    expect(result.reviewerEscalatedFrom).toEqual({
      model: "opencode/jev-1.13-free",
      reason: "System One explicitly requested a reasoning or human review.",
    });
    expect(result.reason).toContain("reasoning reviewer failed");
    expect(result.reason).toContain("shutting down");
    expect(result.reason).not.toContain("System One reviewer");
  });

  test("credits a gate-downgraded reasoning allow to the reasoning reviewer", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const backend = escalatingJevBackend(
      config,
      reasoningAllow(
        "sufficient",
        "The action is supported by complete evidence.",
      ),
    );
    const result = await reviewWithIncompleteEvidence(config, backend);
    expect(result.kind).toBe("escalate");
    expect(result.decisionSource).toBe("deterministic-policy");
    expect(result.decision?.confidence).toBe(0.95);
    expect(result.reviewerModel).toBe("openai/gpt-5.6-luna");
    expect(result.reviewerEscalatedFrom?.model).toBe("opencode/jev-1.13-free");
    expect(result.systemOne?.outcome).toMatchObject({
      choice: "escalate",
      confidence: 0.6,
    });
  });

  test("keeps Jev's scores when a gate downgrades its allow", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const backend = new SystemOneReviewerBackend(
      config,
      undefined,
      undefined,
      async () => response(),
    );
    const result = await reviewWithIncompleteEvidence(config, backend);
    expect(result.kind).toBe("escalate");
    expect(result.decisionSource).toBe("deterministic-policy");
    expect(result.systemOne?.outcome.choice).toBe("allow");
  });

  test("keeps a clear System One escalation manual without paying for reasoning", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    let escalations = 0;
    const backend = new SystemOneReviewerBackend(
      config,
      async () => {
        escalations++;
        return { kind: "deny", reason: "unexpected" };
      },
      "openai/gpt-5.6-luna",
      async () =>
        response({
          outcome: choice("escalate", ["allow", "deny", "escalate"]),
        }),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("escalate");
    expect(result.decisionSource).toBe("system-one-reviewer");
    expect(escalations).toBe(0);
    expect(result.escalationDisposition).toBe("manual");
    expect(result.systemOne).toMatchObject({
      outcome: { choice: "escalate", confidence: 1 },
      reasoningRecommended: false,
    });
  });

  test("honors a valid System One deny without paying for reasoning", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    let escalations = 0;
    const backend = new SystemOneReviewerBackend(
      config,
      async () => {
        escalations++;
        return { kind: "allow", reason: "unexpected" };
      },
      "openai/gpt-5.6-luna",
      async () =>
        response({
          outcome: choice("deny", ["allow", "deny", "escalate"], 0.35),
          primary_basis: choice("destructive_effect", PRIMARY_BASES),
        }),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("deny");
    expect(escalations).toBe(0);
    expect(result.systemOne?.outcome).toMatchObject({
      choice: "deny",
      confidence: 0.35,
    });
    expect(result.systemOne?.supporting.primaryBasis.choice).toBe(
      "destructive_effect",
    );
    expect(result.systemOne?.contradictions).toContain(
      "System One outcome confidence 0.35 is below 0.40",
    );
  });

  test("does not let a reasoning reviewer override an escalation with incomplete evidence", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const backend = escalatingJevBackend(
      config,
      reasoningAllow("partial", "The action appears safe."),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("escalate");
    expect(result.reviewerOutcome).toBe("allow");
    expect(result.reviewerModel).toBe("openai/gpt-5.6-luna");
    expect(result.reviewerEscalatedFrom?.model).toBe("opencode/jev-1.13-free");
    expect(result.systemOne?.outcome.choice).toBe("escalate");
  });

  test("accepts a reasoning reviewer allow backed by sufficient evidence", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    const backend = escalatingJevBackend(
      config,
      reasoningAllow(
        "sufficient",
        "The action is supported by complete evidence.",
      ),
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("allow");
    expect(result.reviewerModel).toBe("openai/gpt-5.6-luna");
  });

  test("does not invoke the reasoning reviewer for a transport failure", async () => {
    const config = resolveConfig({ model: "opencode/jev-1.13-free" });
    let escalations = 0;
    const backend = new SystemOneReviewerBackend(
      config,
      async () => {
        escalations++;
        return { kind: "allow", reason: "unexpected" };
      },
      "openai/gpt-5.6-luna",
      async () => {
        throw new Error("synthetic transport failure");
      },
    );
    const result = await reviewOnce(backend);
    expect(result.kind).toBe("escalate");
    expect(result.decisionSource).toBe("failure-safe");
    expect(escalations).toBe(0);
    expect(result.systemOne).toBeUndefined();
    expect(result.reason).toContain("System One reviewer failed");
    expect(result.reviewerModel).toBe("opencode/jev-1.13-free");
    expect(result.reviewerEscalatedFrom).toBeUndefined();
  });
});
