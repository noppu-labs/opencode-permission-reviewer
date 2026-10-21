import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../../src/config.ts";
import {
  enforceParsedSystemOneReview,
  parseSystemOneReview,
} from "../../src/system-one/review.ts";
import {
  handoffBlock,
  handoffTrigger,
  type JevOutcome,
} from "../../src/system-one/system-one-handoff.ts";
import {
  HANDOFF_BUDGET_FLOOR_MS,
  type SystemOneRouting,
} from "../../src/system-one-routing.ts";
import type { HandoffTrigger } from "../../src/types.ts";
import { defined } from "../helpers.ts";
import {
  attemptWithRemaining,
  choice,
  JEV_ANSWERS,
  JEV_MODEL,
  noul,
  RISKS,
  response,
} from "./system-one-fixtures.ts";

const config = resolveConfig({ model: JEV_MODEL });

function valid(answers: Record<string, unknown>): JevOutcome {
  const parsed = defined(
    parseSystemOneReview(response(answers), config),
    "parsed Jev review",
  );
  return {
    kind: "valid",
    parsed,
    enforced: enforceParsedSystemOneReview(parsed, config),
  };
}

const ROUTINGS: Record<
  "standard" | "reasoningFirst" | "denialReview" | "both",
  SystemOneRouting
> = {
  standard: { reasoningFirst: false, denialReview: false },
  reasoningFirst: { reasoningFirst: true, denialReview: false },
  denialReview: { reasoningFirst: false, denialReview: true },
  both: { reasoningFirst: true, denialReview: true },
};

type Triggers = Record<keyof typeof ROUTINGS, HandoffTrigger | undefined>;

const everywhere = (trigger: HandoffTrigger | undefined): Triggers => ({
  standard: trigger,
  reasoningFirst: trigger,
  denialReview: trigger,
  both: trigger,
});
const withReasoningFirst = (trigger: HandoffTrigger): Triggers => ({
  standard: undefined,
  reasoningFirst: trigger,
  denialReview: undefined,
  both: trigger,
});
const withDenialReview = (trigger: HandoffTrigger): Triggers => ({
  standard: undefined,
  reasoningFirst: undefined,
  denialReview: trigger,
  both: trigger,
});

const TRIGGER_TABLE: { title: string; jev: JevOutcome; expected: Triggers }[] =
  [
    {
      title: "a clean allow",
      jev: valid(JEV_ANSWERS.cleanAllow),
      expected: everywhere(undefined),
    },
    {
      title: "a clean deny",
      jev: valid(JEV_ANSWERS.cleanDeny),
      expected: everywhere(undefined),
    },
    {
      title: "an uncertain allow",
      jev: valid(JEV_ANSWERS.uncertainAllow),
      expected: everywhere("jev-uncertain-allow"),
    },
    {
      title: "an uncertain allow a gate also stops",
      jev: valid(JEV_ANSWERS.uncertainGatedAllow),
      expected: everywhere("jev-uncertain-allow"),
    },
    {
      title: "an escalation below the reasoning threshold",
      jev: valid(JEV_ANSWERS.clearEscalate),
      expected: withReasoningFirst("jev-escalate"),
    },
    {
      title: "an escalation at or above the reasoning threshold",
      jev: valid(JEV_ANSWERS.plausibleEscalate),
      expected: everywhere("jev-escalate"),
    },
    {
      title: "a consistent allow the critical-risk gate stops",
      jev: valid(JEV_ANSWERS.criticalGatedAllow),
      expected: withReasoningFirst("jev-gate"),
    },
    {
      title: "a consistent allow the scope gate stops",
      jev: valid(JEV_ANSWERS.misalignedGatedAllow),
      expected: withReasoningFirst("jev-gate"),
    },
    {
      title: "invalid output",
      jev: { kind: "invalid" },
      expected: withReasoningFirst("jev-invalid"),
    },
    {
      title: "a failure",
      jev: { kind: "failure", error: new Error("synthetic transport failure") },
      expected: withReasoningFirst("jev-failure"),
    },
    {
      title: "an uncertain deny",
      jev: valid(JEV_ANSWERS.uncertainDeny),
      expected: withDenialReview("jev-uncertain-deny"),
    },
  ];

describe("hand-off trigger", () => {
  test.each(TRIGGER_TABLE)("$title", ({ jev, expected }) => {
    const observed = Object.fromEntries(
      Object.entries(ROUTINGS).map(([name, routing]) => [
        name,
        handoffTrigger(jev, routing),
      ]),
    );
    expect(observed).toEqual(expected);
  });
});

const SAFETY_SIGNALS = [
  "unauthorized_data_loss",
  "untrusted_sensitive_disclosure",
  "excessive_credential_access",
  "unauthorized_security_change",
  "unauthorized_external_mutation",
] as const;

function denialTrigger(
  answers: Record<string, unknown>,
): HandoffTrigger | undefined {
  return handoffTrigger(
    valid({ ...JEV_ANSWERS.uncertainDeny, ...answers }),
    ROUTINGS.denialReview,
  );
}

describe("denial review exclusions", () => {
  test("an absolute policy-deny signal of 0.7 keeps an uncertain deny final", () => {
    expect(denialTrigger({ absolute_policy_deny: noul(0.7) })).toBeUndefined();
    expect(denialTrigger({ absolute_policy_deny: noul(0.69) })).toBe(
      "jev-uncertain-deny",
    );
  });

  test.each(SAFETY_SIGNALS.map((signal): [string] => [signal]))(
    "a material %s signal keeps an uncertain deny final",
    (signal) => {
      expect(denialTrigger({ [signal]: noul(0.5) })).toBeUndefined();
      expect(denialTrigger({ [signal]: noul(0.49) })).toBe(
        "jev-uncertain-deny",
      );
    },
  );

  test("critical risk alone does not keep an uncertain deny final", () => {
    expect(denialTrigger({ risk_level: choice("critical", RISKS) })).toBe(
      "jev-uncertain-deny",
    );
  });
});

describe("hand-off block", () => {
  test("the floor is 15 seconds", () => {
    expect(HANDOFF_BUDGET_FLOOR_MS).toBe(15_000);
  });

  test.each([
    { remaining: HANDOFF_BUDGET_FLOOR_MS, block: undefined },
    { remaining: HANDOFF_BUDGET_FLOOR_MS - 1, block: "budget-exhausted" },
  ])("$remaining ms left gives $block", ({ remaining, block }) => {
    const attempt = attemptWithRemaining(remaining);
    try {
      expect(handoffBlock(attempt)).toBe(block);
    } finally {
      attempt.close("finished");
    }
  });

  test("a closed attempt is inactive", () => {
    const attempt = attemptWithRemaining(60_000);
    attempt.close("cancelled");
    expect(handoffBlock(attempt)).toBe("inactive");
  });

  test("an attempt past its deadline is inactive and expires", () => {
    const attempt = attemptWithRemaining(0);
    expect(handoffBlock(attempt)).toBe("inactive");
    expect(attempt.state).toBe("expired");
  });
});
