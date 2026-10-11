import { replayConfig } from "./replay-config.mjs";
import { envelopeFor } from "./replay-envelope.mjs";
import { sha256 } from "./util.mjs";

/** Run the core review engine on a ready envelope with `review` standing in for the model. */
export const evaluate = (engine, e, cfg, review) =>
  engine.evaluateReview(e.request, cfg, {
    collect: async () => e,
    review,
    active: () => true,
    auxiliarySession: () => false,
    observe: () => {},
  });
const tenantPolicyFor = (policy, cfg, input) =>
  (cfg.policy ?? policy.DEFAULT_TENANT_POLICY) +
  (input.policyAppend
    ? `\n\n## Trusted case-specific restrictions\n${input.policyAppend}`
    : "");
const systemPromptFor = (policy, model) =>
  policy.REVIEWER_SYSTEM_PROMPT +
  (model?.format === "tool"
    ? "\nReturn the decision using permission_reviewer_result exactly once, then stop."
    : "");
const promptHashFor = (
  { decisionSchema, systemOneQuestions },
  model,
  { state, system, user },
) =>
  model?.format === "system_one"
    ? sha256({
        state,
        questions: systemOneQuestions.SYSTEM_ONE_QUESTIONS,
        specVersion: systemOneQuestions.SYSTEM_ONE_SPEC_VERSION,
      })
    : sha256({
        system,
        user,
        format: model?.format ?? "text",
        schema: decisionSchema.DECISION_SCHEMA,
      });
/** Everything the kit sends to or records about a model for one case, plus the core preflight outcome. */
export async function prepare(core, input, model) {
  const { context, policy, decisionSchema, systemOneQuestions } = core;
  const cfg = replayConfig(core.config.DEFAULT_CONFIG, input, model),
    envelope = envelopeFor(core, input, cfg);
  let reached = false;
  const preflight = await evaluate(core.engine, envelope, cfg, async () => {
    reached = true;
    return {
      kind: "escalate",
      reason: "BENCHMARK preflight: no model invoked.",
      decisionSource: "failure-safe",
    };
  });
  const evidence = context.buildEvidenceResult(envelope, cfg);
  envelope.actionEvidenceComplete =
    envelope.actionEvidenceComplete !== false &&
    evidence.actionEvidenceComplete;
  const tenantPolicy = tenantPolicyFor(policy, cfg, input);
  const user = policy.buildReviewerPrompt(
    tenantPolicy,
    evidence.text,
    cfg.outputFormat,
  );
  const system = systemPromptFor(policy, model);
  const state = {
    trustedPolicy: {
      reviewer: policy.REVIEWER_SYSTEM_PROMPT,
      tenant: tenantPolicy,
    },
    untrustedEvidence: evidence.text,
  };
  return {
    config: cfg,
    envelope,
    system,
    user,
    evidence: evidence.text,
    schema: decisionSchema.DECISION_SCHEMA,
    systemOne: {
      state,
      questions: systemOneQuestions.SYSTEM_ONE_QUESTIONS,
    },
    reachable: reached,
    bypass: reached ? null : preflight,
    promptHash: promptHashFor(core, model, { state, system, user }),
    evidenceHash: sha256(evidence.text),
    actionEvidenceComplete: envelope.actionEvidenceComplete,
  };
}
