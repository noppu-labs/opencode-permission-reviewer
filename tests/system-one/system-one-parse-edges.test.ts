import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../../src/config.ts";
import { parseSystemOneReview } from "../../src/system-one/review.ts";
import { defined } from "../helpers.ts";
import { choice, PRIMARY_BASES, response } from "./system-one-fixtures.ts";

const OUTCOMES = ["allow", "deny", "escalate"];
const RISKS = ["low", "medium", "high", "critical"];
const AUTHORIZATIONS = ["high", "medium", "low", "unknown"];
const ALIGNMENTS = ["aligned", "partial", "misaligned", "unknown"];
const COMPLETENESS = ["sufficient", "partial", "insufficient", "unknown"];

const jev = resolveConfig({ model: "opencode/jev-1.13-free" });
const commandCode = resolveConfig({ model: "commandcode/typesafe/jev" });

const noul = (value: unknown): { type: string; noul: unknown } => ({
  type: "noul",
  noul: value,
});

const outcomeAnswer = (
  overrides: Record<string, unknown>,
): Record<string, unknown> => ({
  outcome: { ...choice("allow", OUTCOMES), ...overrides },
});

const withoutAnswer = (key: string): Record<string, unknown> => {
  const raw = response();
  delete raw.answers[key];
  return raw;
};

describe("System One response rejection", () => {
  test.each<[string, unknown]>([
    ["a null response", null],
    ["a string response", "jev"],
    ["an array response", []],
    ["a numeric model", { ...response(), model: 7 }],
    ["a model without the jev prefix", { ...response(), model: "jevx" }],
    ["a TypeSafe model ID on Zen", { ...response(), model: "typesafe/jev" }],
    ["missing answers", { ...response(), answers: undefined }],
    ["null answers", { ...response(), answers: null }],
    ["array answers", { ...response(), answers: [] }],
    ["string answers", { ...response(), answers: "allow" }],
    ["an extra answer", response({ extra: noul(0) })],
    ["a missing answer", withoutAnswer("absolute_policy_deny")],
    ["a string choice", response({ outcome: "allow" })],
    ["a null choice", response({ outcome: null })],
    ["an array choice", response({ outcome: [] })],
    ["a choice typed noul", response(outcomeAnswer({ type: "noul" }))],
    ["an unknown option", response(outcomeAnswer({ choice: "maybe" }))],
    ["confidence above 1", response(outcomeAnswer({ confidence: 1.5 }))],
    ["confidence below 0", response(outcomeAnswer({ confidence: -0.1 }))],
    ["NaN confidence", response(outcomeAnswer({ confidence: Number.NaN }))],
    ["string confidence", response(outcomeAnswer({ confidence: "1" }))],
    ["null probabilities", response(outcomeAnswer({ probabilities: null }))],
    ["string probabilities", response(outcomeAnswer({ probabilities: "x" }))],
    ["array probabilities", response(outcomeAnswer({ probabilities: [1, 0] }))],
    [
      "a missing probability",
      response(outcomeAnswer({ probabilities: { allow: 1, deny: 0 } })),
    ],
    [
      "an extra probability",
      response(
        outcomeAnswer({
          probabilities: { allow: 1, deny: 0, escalate: 0, other: 0 },
        }),
      ),
    ],
    [
      "a string probability",
      response(
        outcomeAnswer({ probabilities: { allow: 1, deny: "0", escalate: 0 } }),
      ),
    ],
    [
      "an infinite probability",
      response(
        outcomeAnswer({
          probabilities: { allow: 1, deny: Infinity, escalate: 0 },
        }),
      ),
    ],
    [
      "probabilities summing to 0.97",
      response(
        outcomeAnswer({
          confidence: 0.97,
          probabilities: { allow: 0.97, deny: 0, escalate: 0 },
        }),
      ),
    ],
    [
      "probabilities summing to 1.03",
      response(
        outcomeAnswer({ probabilities: { allow: 1, deny: 0.03, escalate: 0 } }),
      ),
    ],
    [
      "a basis with too few probabilities",
      response({
        primary_basis: choice("authorized_routine", PRIMARY_BASES.slice(1)),
      }),
    ],
    ["a string signal", response({ within_intent_scope: "1" })],
    ["a null signal", response({ within_intent_scope: null })],
    ["an array signal", response({ within_intent_scope: [] })],
    [
      "a signal typed choice",
      response({ within_intent_scope: { type: "choice", noul: 1 } }),
    ],
    ["a signal above 1", response({ within_intent_scope: noul(1.5) })],
    ["a signal below 0", response({ within_intent_scope: noul(-0.1) })],
    [
      "a signal without a value",
      response({ within_intent_scope: noul(undefined) }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseSystemOneReview(raw, jev)).toBeUndefined();
  });

  test("accepts the model IDs each provider may return", () => {
    expect(
      parseSystemOneReview({ ...response(), model: "jev" }, jev),
    ).toBeDefined();
    expect(
      parseSystemOneReview({ ...response(), model: "jev-2" }, jev),
    ).toBeDefined();
    expect(
      parseSystemOneReview(
        { ...response(), model: "typesafe/jev" },
        commandCode,
      )?.returnedModel,
    ).toBe("typesafe/jev");
    expect(parseSystemOneReview(response(), commandCode)).toBeUndefined();
  });

  test("accepts probabilities at the sum bounds and a tied most probable choice", () => {
    const bounds = [
      { allow: 0.98, deny: 0, escalate: 0 },
      { allow: 0.5, deny: 0.5, escalate: 0 },
      { allow: 0.99, deny: 0.005, escalate: 0.005 },
    ];
    for (const probabilities of bounds) {
      const parsed = parseSystemOneReview(
        response(outcomeAnswer({ confidence: 0.98, probabilities })),
        jev,
      );
      expect(parsed?.scores.outcome.probabilities).toEqual(probabilities);
    }
  });

  test("copies the outcome probabilities into the scores", () => {
    const raw = response();
    const parsed = defined(parseSystemOneReview(raw, jev), "parsed review");
    const answer = raw.answers.outcome as { probabilities: object };
    expect(parsed.scores.outcome.probabilities).toEqual(
      answer.probabilities as never,
    );
    expect(parsed.scores.outcome.probabilities).not.toBe(
      answer.probabilities as never,
    );
  });
});

interface Expected {
  outcome: string;
  contradictions: string[];
  difficult: boolean;
  reasoning: boolean;
}

const allowWith = (
  contradictions: string[],
  reasoning = contradictions.length > 0,
): Expected => ({
  outcome: "allow",
  contradictions,
  difficult: contradictions.length > 0,
  reasoning,
});

const SAFETY = "an allow has a material safety signal";
const LOW_RISK = "low risk conflicts with a material safety signal";
const POLICY_DENY =
  "the disposition conflicts with an absolute policy-deny signal";
const DESTRUCTIVE_DENY = {
  outcome: choice("deny", OUTCOMES),
  risk_level: choice("high", RISKS),
  primary_basis: choice("destructive_effect", PRIMARY_BASES),
};

describe("System One consistency checks", () => {
  test.each<[string, Record<string, unknown>, Expected]>([
    ["a consistent allow", {}, allowWith([])],
    [
      "an allow below the confidence threshold",
      { outcome: choice("allow", OUTCOMES, 0.39) },
      allowWith(["System One outcome confidence 0.39 is below 0.40"]),
    ],
    [
      "an allow at the confidence threshold",
      { outcome: choice("allow", OUTCOMES, 0.4) },
      allowWith([]),
    ],
    [
      "an allow with a very weak supporting choice",
      { risk_level: choice("low", RISKS, 0.25) },
      allowWith(["a supporting classification has very low confidence"]),
    ],
    [
      "an allow with a supporting choice at 0.3",
      { risk_level: choice("low", RISKS, 0.3) },
      allowWith([]),
    ],
    [
      "an allow on a restrictive basis",
      { primary_basis: choice("scope_mismatch", PRIMARY_BASES) },
      allowWith(["an allow used a restrictive primary basis"]),
    ],
    [
      "an allow on the reversible-change basis",
      { primary_basis: choice("authorized_reversible_change", PRIMARY_BASES) },
      allowWith([]),
    ],
    [
      "a deny on an approving basis",
      { outcome: choice("deny", OUTCOMES) },
      {
        outcome: "deny",
        contradictions: ["a deny used an approving primary basis"],
        difficult: true,
        reasoning: false,
      },
    ],
    [
      "a consistent deny under an absolute policy-deny signal",
      { ...DESTRUCTIVE_DENY, absolute_policy_deny: noul(0.9) },
      {
        outcome: "deny",
        contradictions: [],
        difficult: false,
        reasoning: false,
      },
    ],
    [
      "an aligned scope with a weak intent-scope signal",
      { within_intent_scope: noul(0.2) },
      allowWith([
        "scope alignment conflicts with the intent-scope signal",
        "an allow lacks probable scope alignment",
      ]),
    ],
    [
      "an aligned scope with an intent-scope signal of 0.3",
      { within_intent_scope: noul(0.3) },
      allowWith(["an allow lacks probable scope alignment"]),
    ],
    [
      "a misaligned scope with a strong intent-scope signal",
      {
        scope_alignment: choice("misaligned", ALIGNMENTS),
        within_intent_scope: noul(0.8),
      },
      allowWith(["scope misalignment conflicts with the intent-scope signal"]),
    ],
    [
      "a misaligned scope with an intent-scope signal of 0.7",
      {
        scope_alignment: choice("misaligned", ALIGNMENTS),
        within_intent_scope: noul(0.7),
      },
      allowWith([]),
    ],
    [
      "sufficient evidence with a missing-evidence signal",
      { essential_evidence_missing: noul(0.8) },
      allowWith([
        "evidence completeness conflicts with the missing-evidence signal",
        SAFETY,
      ]),
    ],
    [
      "insufficient evidence without a missing-evidence signal",
      {
        evidence_completeness: choice("insufficient", COMPLETENESS),
        essential_evidence_missing: noul(0.2),
      },
      allowWith([
        "evidence insufficiency conflicts with the missing-evidence signal",
      ]),
    ],
    [
      "insufficient evidence with a missing-evidence signal of 0.3",
      {
        evidence_completeness: choice("insufficient", COMPLETENESS),
        essential_evidence_missing: noul(0.3),
      },
      allowWith([]),
    ],
    [
      "high authorization with a weak material-authorization signal",
      { material_authorization: noul(0.2) },
      allowWith([
        "authorization level conflicts with the material-authorization signal",
      ]),
    ],
    [
      "medium authorization with a weak material-authorization signal",
      {
        user_authorization: choice("medium", AUTHORIZATIONS),
        material_authorization: noul(0.2),
      },
      allowWith([
        "authorization level conflicts with the material-authorization signal",
      ]),
    ],
    [
      "low authorization with a weak material-authorization signal",
      {
        user_authorization: choice("low", AUTHORIZATIONS),
        material_authorization: noul(0.2),
      },
      allowWith([]),
    ],
    [
      "low risk with a data-loss signal",
      { unauthorized_data_loss: noul(0.8) },
      allowWith([LOW_RISK, SAFETY]),
    ],
    [
      "low risk with a disclosure signal",
      { untrusted_sensitive_disclosure: noul(0.8) },
      allowWith([LOW_RISK, SAFETY]),
    ],
    [
      "low risk with a credential signal",
      { excessive_credential_access: noul(0.8) },
      allowWith([LOW_RISK, SAFETY]),
    ],
    [
      "low risk with a security-change signal",
      { unauthorized_security_change: noul(0.8) },
      allowWith([LOW_RISK, SAFETY]),
    ],
    [
      "low risk with a safety signal of 0.7",
      { unauthorized_data_loss: noul(0.7) },
      allowWith([SAFETY]),
    ],
    [
      "an allow with an external-mutation signal",
      { unauthorized_external_mutation: noul(0.8) },
      allowWith([SAFETY]),
    ],
    [
      "an allow with an external-mutation signal just under 0.5",
      { unauthorized_external_mutation: noul(0.49) },
      allowWith([]),
    ],
    [
      "an allow under an absolute policy-deny signal of 0.7",
      { absolute_policy_deny: noul(0.7) },
      allowWith([POLICY_DENY, SAFETY]),
    ],
    [
      "a non-low-risk allow with a weak material-authorization signal",
      {
        risk_level: choice("medium", RISKS),
        material_authorization: noul(0.4),
      },
      allowWith([
        "a non-low-risk allow lacks confident material authorization",
      ]),
    ],
    [
      "a non-low-risk allow with a material-authorization signal of 0.5",
      {
        risk_level: choice("medium", RISKS),
        material_authorization: noul(0.5),
      },
      allowWith([]),
    ],
    [
      "an allow with partial evidence at 0.7 confidence",
      {
        outcome: choice("allow", OUTCOMES, 0.7),
        evidence_completeness: choice("partial", COMPLETENESS),
      },
      allowWith([]),
    ],
    [
      "a clear escalation with a policy-deny signal",
      {
        outcome: choice("escalate", OUTCOMES),
        absolute_policy_deny: noul(0.8),
      },
      {
        outcome: "escalate",
        contradictions: [POLICY_DENY],
        difficult: true,
        reasoning: false,
      },
    ],
    [
      "an escalation at the reasoning threshold",
      { outcome: choice("escalate", OUTCOMES, 0.62) },
      {
        outcome: "escalate",
        contradictions: [],
        difficult: true,
        reasoning: true,
      },
    ],
    [
      "an escalation just under the reasoning threshold",
      { outcome: choice("escalate", OUTCOMES, 0.63) },
      {
        outcome: "escalate",
        contradictions: [],
        difficult: true,
        reasoning: false,
      },
    ],
  ])("%s", (_label, overrides, expected) => {
    const parsed = defined(
      parseSystemOneReview(response(overrides), jev),
      "parsed review",
    );
    expect(parsed.decision.outcome).toBe(expected.outcome as never);
    expect(parsed.scores.contradictions).toEqual(expected.contradictions);
    expect(parsed.difficultReason !== undefined).toBe(expected.difficult);
    expect("difficultReason" in parsed).toBe(expected.difficult);
    expect(parsed.reasoningRecommended).toBe(expected.reasoning);
    expect(parsed.scores.reasoningRecommended).toBe(expected.reasoning);
  });

  test("names every contradiction in the difficult reason", () => {
    const parsed = parseSystemOneReview(
      response({ within_intent_scope: noul(0.2) }),
      jev,
    );
    expect(parsed?.difficultReason).toBe(
      "System One decision is uncertain or inconsistent: scope alignment conflicts with the intent-scope signal; an allow lacks probable scope alignment.",
    );
    const escalated = parseSystemOneReview(
      response({ outcome: choice("escalate", OUTCOMES) }),
      jev,
    );
    expect(escalated?.difficultReason).toBe(
      "System One explicitly requested a reasoning or human review.",
    );
  });
});
