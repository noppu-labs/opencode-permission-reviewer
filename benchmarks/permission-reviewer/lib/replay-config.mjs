const reviewerModel = (model, base) =>
  model?.transport === "system-one" && model.model === "typesafe/jev"
    ? "commandcode/typesafe/jev"
    : (model?.model ?? base.model);
/** The plugin defaults with the case config and the benchmark model applied; audit and session retention off. */
export function replayConfig(defaults, input, model) {
  const base = structuredClone(defaults),
    overrides = structuredClone(input.config ?? {});
  return {
    ...base,
    ...overrides,
    riskPolicy: {
      ...base.riskPolicy,
      ...overrides.riskPolicy,
      allow: { ...base.riskPolicy.allow, ...overrides.riskPolicy?.allow },
    },
    model: reviewerModel(model, base),
    variant: model?.variant ?? base.variant,
    outputFormat: model?.format === "text" ? "text" : "json_schema",
    audit: false,
    retainReviewSessions: false,
  };
}
