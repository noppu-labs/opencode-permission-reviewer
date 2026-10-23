import { describe, expect, test } from "bun:test";
import type {
  HandoffTrigger,
  ManualResolution,
  ReviewExecutionResult,
} from "../../src/kernel/review-result.ts";
import type { ReviewerConfig } from "../../src/kernel/reviewer-config.ts";
import { resolveConfig } from "../../src/modules/config/services/config.ts";
import type { ReviewEnvelope } from "../../src/modules/context/models/review-envelope.ts";
import { ReviewAttempt } from "../../src/modules/review/services/review-attempt.ts";
import { evaluateReview } from "../../src/modules/review/services/review-engine.ts";
import { SystemOneReviewerBackend } from "../../src/modules/reviewer/services/backend.ts";
import { defined } from "../helpers.ts";
import {
  choice,
  envelope,
  JEV_ANSWERS,
  JEV_MODEL,
  type JevScript,
  noul,
  PRIMARY_BASES,
  REASONING_DENY,
  REASONING_ESCALATE,
  REASONING_MODEL,
  REASONING_UNAVAILABLE,
  RISKS,
  reasoningAllow,
  response,
  reviewOnce,
  routedBackend,
  routingConfig,
} from "./system-one-fixtures.ts";

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
      backend.review(value, new ReviewAttempt("generation", 60_000)),
    active: () => true,
    auxiliarySession: () => false,
    observe: () => {},
  });
}

/** What a test sees of one routed review. */
interface Route {
  kind: ReviewExecutionResult["kind"];
  decisionSource: ReviewExecutionResult["decisionSource"];
  reasoningCalls: number;
  escalationDisposition?: ReviewExecutionResult["escalationDisposition"];
  trigger?: HandoffTrigger;
  resolution?: ManualResolution;
}

async function observedRoute(
  config: ReviewerConfig,
  jev: JevScript,
): Promise<Route> {
  const { backend, calls } = routedBackend(config, jev);
  const result = await reviewOnce(backend);
  const trigger = result.reviewerEscalatedFrom?.trigger;
  return {
    kind: result.kind,
    decisionSource: result.decisionSource,
    reasoningCalls: calls(),
    ...(result.escalationDisposition === undefined
      ? {}
      : { escalationDisposition: result.escalationDisposition }),
    ...(trigger === undefined ? {} : { trigger }),
    ...(result.resolution === undefined
      ? {}
      : { resolution: result.resolution }),
  };
}

const jevFinal = (kind: "allow" | "deny"): Route => ({
  kind,
  decisionSource: "system-one-reviewer",
  reasoningCalls: 0,
});
/** The reasoning stub denies, so a hand-off reads as an llm-reviewer deny. */
const reasoned = (trigger: HandoffTrigger): Route => ({
  kind: "deny",
  decisionSource: "llm-reviewer",
  reasoningCalls: 1,
  trigger,
});
const JEV_ESCALATED: Route = {
  kind: "escalate",
  decisionSource: "system-one-reviewer",
  reasoningCalls: 0,
  escalationDisposition: "manual",
  resolution: "reviewer",
};
const JEV_FAILED: Route = {
  kind: "escalate",
  decisionSource: "failure-safe",
  reasoningCalls: 0,
  escalationDisposition: "manual",
  resolution: "reviewer",
};

interface RoutingRow {
  title: string;
  jev: JevScript;
  standard: Route;
  reasoningFirst: Route;
}

const ROUTING_TABLE: RoutingRow[] = [
  {
    title: "a clean allow",
    jev: JEV_ANSWERS.cleanAllow,
    standard: jevFinal("allow"),
    reasoningFirst: jevFinal("allow"),
  },
  {
    title: "a clean deny",
    jev: JEV_ANSWERS.cleanDeny,
    standard: jevFinal("deny"),
    reasoningFirst: jevFinal("deny"),
  },
  {
    title: "an uncertain allow",
    jev: JEV_ANSWERS.uncertainAllow,
    standard: reasoned("jev-uncertain-allow"),
    reasoningFirst: reasoned("jev-uncertain-allow"),
  },
  {
    title: "an uncertain allow a gate also stops",
    jev: JEV_ANSWERS.uncertainGatedAllow,
    standard: reasoned("jev-uncertain-allow"),
    reasoningFirst: reasoned("jev-uncertain-allow"),
  },
  {
    title: "an escalation below the reasoning threshold",
    jev: JEV_ANSWERS.clearEscalate,
    standard: JEV_ESCALATED,
    reasoningFirst: reasoned("jev-escalate"),
  },
  {
    title: "an escalation at or above the reasoning threshold",
    jev: JEV_ANSWERS.plausibleEscalate,
    standard: reasoned("jev-escalate"),
    reasoningFirst: reasoned("jev-escalate"),
  },
  {
    title: "a consistent allow the critical-risk gate stops",
    jev: JEV_ANSWERS.criticalGatedAllow,
    standard: JEV_ESCALATED,
    reasoningFirst: reasoned("jev-gate"),
  },
  {
    title: "a consistent allow the scope gate stops",
    jev: JEV_ANSWERS.misalignedGatedAllow,
    standard: JEV_ESCALATED,
    reasoningFirst: reasoned("jev-gate"),
  },
  {
    title: "invalid Jev output",
    jev: "invalid",
    standard: JEV_FAILED,
    reasoningFirst: reasoned("jev-invalid"),
  },
  {
    title: "a Jev transport failure",
    jev: "failure",
    standard: JEV_FAILED,
    reasoningFirst: reasoned("jev-failure"),
  },
  {
    title: "an uncertain deny without denial review",
    jev: JEV_ANSWERS.uncertainDeny,
    standard: jevFinal("deny"),
    reasoningFirst: jevFinal("deny"),
  },
];

const DENIAL_REVIEW_TABLE: { title: string; jev: JevScript; route: Route }[] = [
  {
    title: "an uncertain deny",
    jev: JEV_ANSWERS.uncertainDeny,
    route: reasoned("jev-uncertain-deny"),
  },
  {
    title: "a clean deny",
    jev: JEV_ANSWERS.cleanDeny,
    route: jevFinal("deny"),
  },
  {
    title: "an uncertain deny with an absolute policy-deny signal",
    jev: { ...JEV_ANSWERS.uncertainDeny, absolute_policy_deny: noul(0.7) },
    route: jevFinal("deny"),
  },
  {
    title: "an uncertain deny with a material data-loss signal",
    jev: { ...JEV_ANSWERS.uncertainDeny, unauthorized_data_loss: noul(0.5) },
    route: jevFinal("deny"),
  },
  {
    title: "an uncertain deny with a material disclosure signal",
    jev: {
      ...JEV_ANSWERS.uncertainDeny,
      untrusted_sensitive_disclosure: noul(0.5),
    },
    route: jevFinal("deny"),
  },
  {
    title: "an uncertain deny with a material credential signal",
    jev: {
      ...JEV_ANSWERS.uncertainDeny,
      excessive_credential_access: noul(0.5),
    },
    route: jevFinal("deny"),
  },
  {
    title: "an uncertain deny with a material security-change signal",
    jev: {
      ...JEV_ANSWERS.uncertainDeny,
      unauthorized_security_change: noul(0.5),
    },
    route: jevFinal("deny"),
  },
  {
    title: "an uncertain deny with a material external-mutation signal",
    jev: {
      ...JEV_ANSWERS.uncertainDeny,
      unauthorized_external_mutation: noul(0.5),
    },
    route: jevFinal("deny"),
  },
];

describe("System One routing table", () => {
  test.each(ROUTING_TABLE)(
    "$title",
    async ({ jev, standard, reasoningFirst }) => {
      expect(await observedRoute(routingConfig("standard"), jev)).toEqual(
        standard,
      );
      expect(
        await observedRoute(routingConfig("reasoning-first"), jev),
      ).toEqual(reasoningFirst);
    },
  );

  test.each(DENIAL_REVIEW_TABLE)(
    "denial review: $title",
    async ({ jev, route }) => {
      expect(await observedRoute(routingConfig("standard", true), jev)).toEqual(
        route,
      );
      expect(
        await observedRoute(routingConfig("reasoning-first", true), jev),
      ).toEqual(route);
    },
  );

  test("both settings stay inert without an escalationReviewer", async () => {
    const inert = routingConfig("reasoning-first", true, {
      escalationReviewer: undefined,
    });
    expect(await observedRoute(inert, JEV_ANSWERS.clearEscalate)).toEqual(
      JEV_ESCALATED,
    );
    expect(await observedRoute(inert, JEV_ANSWERS.uncertainDeny)).toEqual(
      jevFinal("deny"),
    );
  });
});

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
    // Jev's scores go in `systemOne`; `reviewerEscalatedFrom` keeps the model,
    // the reason and the hand-off trigger.
    expect(
      Object.keys(
        defined(result.reviewerEscalatedFrom, "reviewerEscalatedFrom"),
      ).sort(),
    ).toEqual(["model", "reason", "trigger"]);
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
      trigger: "jev-escalate",
    });
    expect(result.resolution).toBe("reasoning-unavailable");
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

const HANDOFFS: {
  trigger: HandoffTrigger;
  jev: JevScript;
  config: ReviewerConfig;
}[] = [
  {
    trigger: "jev-escalate",
    jev: JEV_ANSWERS.clearEscalate,
    config: routingConfig("reasoning-first"),
  },
  {
    trigger: "jev-uncertain-allow",
    jev: JEV_ANSWERS.uncertainAllow,
    config: routingConfig("standard"),
  },
  {
    trigger: "jev-gate",
    jev: JEV_ANSWERS.misalignedGatedAllow,
    config: routingConfig("reasoning-first"),
  },
  {
    trigger: "jev-invalid",
    jev: "invalid",
    config: routingConfig("reasoning-first"),
  },
  {
    trigger: "jev-failure",
    jev: "failure",
    config: routingConfig("reasoning-first"),
  },
  {
    trigger: "jev-uncertain-deny",
    jev: JEV_ANSWERS.uncertainDeny,
    config: routingConfig("standard", true),
  },
];

async function handedOff(
  config: ReviewerConfig,
  jev: JevScript,
  reasoning: () => Promise<ReviewExecutionResult>,
): Promise<ReviewExecutionResult> {
  const { backend, calls } = routedBackend(config, jev, reasoning);
  const result = await reviewOnce(backend);
  expect(calls()).toBe(1);
  return result;
}

describe("reasoning reviewer results after a hand-off", () => {
  test.each(HANDOFFS)(
    "$trigger: an allow without sufficient evidence stays an escalation",
    async ({ trigger, jev, config }) => {
      const result = await handedOff(config, jev, async () =>
        reasoningAllow("partial"),
      );
      expect(result).toMatchObject({
        kind: "escalate",
        reviewerOutcome: "allow",
        resolution: "reasoning-escalated",
        reviewerModel: REASONING_MODEL,
        reviewerEscalatedFrom: { model: JEV_MODEL, trigger },
      });
    },
  );

  test.each(HANDOFFS)(
    "$trigger: an allow on sufficient evidence stands",
    async ({ trigger, jev, config }) => {
      const result = await handedOff(config, jev, async () =>
        reasoningAllow("sufficient"),
      );
      expect(result.kind).toBe("allow");
      expect(result.reviewerEscalatedFrom?.trigger).toBe(trigger);
      expect("resolution" in result).toBe(false);
    },
  );

  test.each(HANDOFFS)(
    "$trigger: the reasoning reviewer's escalation is final and left for the engine to dispose",
    async ({ jev, config }) => {
      const result = await handedOff(
        config,
        jev,
        async () => REASONING_ESCALATE,
      );
      expect(result).toMatchObject({
        kind: "escalate",
        decisionSource: "llm-reviewer",
        resolution: "reasoning-escalated",
      });
      expect(result.escalationDisposition).toBeUndefined();
    },
  );

  test.each(HANDOFFS)(
    "$trigger: an unavailable reasoning reviewer ends in its own final escalation",
    async ({ jev, config }) => {
      const result = await handedOff(
        config,
        jev,
        async () => REASONING_UNAVAILABLE,
      );
      expect(result).toMatchObject({
        kind: "escalate",
        decisionSource: "failure-safe",
        resolution: "reasoning-unavailable",
        escalationDisposition: "manual",
        reason: REASONING_UNAVAILABLE.reason,
      });
    },
  );

  test.each(HANDOFFS)(
    "$trigger: a reasoning reviewer that throws ends in a final escalation",
    async ({ trigger, jev, config }) => {
      const result = await handedOff(config, jev, async () => {
        throw new Error("synthetic reasoning outage");
      });
      expect(result).toMatchObject({
        kind: "escalate",
        decisionSource: "failure-safe",
        resolution: "reasoning-unavailable",
        escalationDisposition: "manual",
        reviewerModel: REASONING_MODEL,
        reviewerEscalatedFrom: { model: JEV_MODEL, trigger },
      });
      expect(result.reason).toContain("reasoning reviewer failed");
    },
  );

  test("Jev's scores travel with a hand-off only when Jev answered", async () => {
    const config = routingConfig("reasoning-first");
    const answered = await handedOff(
      config,
      JEV_ANSWERS.clearEscalate,
      async () => REASONING_DENY,
    );
    const invalid = await handedOff(
      config,
      "invalid",
      async () => REASONING_DENY,
    );
    const failed = await handedOff(
      config,
      "failure",
      async () => REASONING_DENY,
    );
    expect(answered.systemOne?.outcome.choice).toBe("escalate");
    expect(invalid.systemOne).toBeUndefined();
    expect(failed.systemOne).toBeUndefined();
  });

  test("the hand-off reason is Jev's own", async () => {
    const config = routingConfig("reasoning-first", true);
    const reasonFor = async (jev: JevScript): Promise<string | undefined> =>
      (await handedOff(config, jev, async () => REASONING_DENY))
        .reviewerEscalatedFrom?.reason;
    expect(await reasonFor("invalid")).toBe(
      "System One reviewer returned a missing, invalid, or ambiguous decision.",
    );
    expect(await reasonFor("failure")).toContain("System One reviewer failed");
    expect(await reasonFor(JEV_ANSWERS.criticalGatedAllow)).toBe(
      "Reviewer returned a non-denial for critical risk; manual review required.",
    );
    expect(await reasonFor(JEV_ANSWERS.uncertainDeny)).toStartWith(
      "System One decision is uncertain or inconsistent:",
    );
  });

  test("an uncertain critical-risk Jev denial is reviewed, and a reasoning approval of it escalates", async () => {
    const config = routingConfig("standard", true);
    const jev: JevScript = {
      ...JEV_ANSWERS.uncertainDeny,
      risk_level: choice("critical", RISKS),
    };
    const result = await handedOff(config, jev, async () => REASONING_DENY);
    expect(result.reviewerEscalatedFrom?.trigger).toBe("jev-uncertain-deny");
    expect(result.kind).toBe("deny");
    const approved = await handedOff(config, jev, async () =>
      reasoningAllow("sufficient"),
    );
    expect(approved).toMatchObject({
      kind: "escalate",
      reason:
        "Jev rated this request critical risk; a reasoning approval needs manual review.",
      resolution: "reasoning-escalated",
      reviewerEscalatedFrom: { trigger: "jev-uncertain-deny" },
    });
  });
});
