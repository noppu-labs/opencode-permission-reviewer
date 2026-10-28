// The plugin's System One provider for a benchmark profile. typesafe/jev goes
// to Command Code. Otherwise the provider comes from the endpoint the kit's
// transport calls, else from its key variable, else the TypeSafe SDK default,
// which is the typesafe-ai provider.
const SYSTEM_ONE_ENDPOINTS = {
  "https://opencode.ai/zen": "opencode",
  "https://api.typesafe.ai": "typesafe-ai",
  "https://api.commandcode.ai/provider": "commandcode",
  "https://api.liquid.ai/decisions": "liquid-ai",
  "https://inference.baseten.co": "baseten",
};
const SYSTEM_ONE_KEY_ENVS = {
  OPENCODE_API_KEY: "opencode",
  TYPESAFE_API_KEY: "typesafe-ai",
  CMD_API_KEY: "commandcode",
  LIQUID_API_KEY: "liquid-ai",
  BASETEN_API_KEY: "baseten",
};
const lookup = (table, key) =>
  Object.hasOwn(table, key) ? table[key] : undefined;
const systemOneProvider = (model) =>
  model.model === "typesafe/jev"
    ? "commandcode"
    : ((model.endpoint === undefined
        ? undefined
        : lookup(SYSTEM_ONE_ENDPOINTS, model.endpoint.replace(/\/+$/, ""))) ??
      (model.apiKeyEnv === undefined
        ? undefined
        : lookup(SYSTEM_ONE_KEY_ENVS, model.apiKeyEnv)) ??
      "typesafe-ai");
const reviewerModel = (model, base) =>
  model?.transport === "system-one"
    ? `${systemOneProvider(model)}/${model.model}`
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
