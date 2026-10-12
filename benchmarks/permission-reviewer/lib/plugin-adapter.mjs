import { evaluate, prepare } from "./replay-prepare.mjs";

function failureSafe({ escalation }, errorKind, config) {
  const transport = errorKind === "transport";
  return escalation.applyEscalationDisposition(
    {
      kind: "escalate",
      reason: transport
        ? "Benchmark provider request failed."
        : "Reviewer returned missing, invalid or ambiguous output.",
      decisionSource: "failure-safe",
    },
    config,
    transport ? "reviewer-failure" : "invalid-decision",
  );
}
function gatedResult(core, config, parsed, errorKind, parsedSystemOne) {
  if (!parsed) return failureSafe(core, errorKind, config);
  return parsedSystemOne
    ? {
        ...core.systemOne.enforceParsedSystemOneReview(parsedSystemOne, config),
        decisionSource: "system-one-reviewer",
      }
    : {
        ...core.decisionGates.enforceDecision(parsed, config),
        decisionSource: "llm-reviewer",
      };
}
async function finish(core, prepared, parsed, errorKind, parsedSystemOne) {
  const result = gatedResult(
    core,
    prepared.config,
    parsed,
    errorKind,
    parsedSystemOne,
  );
  const gated = structuredClone(result);
  const effective = await evaluate(
    core.engine,
    prepared.envelope,
    prepared.config,
    async () => structuredClone(result),
  );
  return { gated, effective };
}
/** The benchmark's view of the plugin: its parsers, plus prepare and finish around the core review engine. */
export function replayAdapter(snapshot, core) {
  return {
    snapshot,
    schema: core.decisionSchema.DECISION_SCHEMA,
    promptVersion: core.policy.REVIEWER_PROMPT_VERSION,
    parse: (text) => core.decision.parseDecisionFromText(text),
    parseObject: (obj) => core.decision.parseDecision(obj),
    parseSystemOne: (obj, cfg) => core.systemOne.parseSystemOneReview(obj, cfg),
    prepare: (input, model) => prepare(core, input, model),
    finish: (prepared, parsed, errorKind, parsedSystemOne) =>
      finish(core, prepared, parsed, errorKind, parsedSystemOne),
  };
}
