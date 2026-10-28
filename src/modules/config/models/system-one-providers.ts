// The providers that serve System One decision models: which model IDs each
// accepts, where its endpoint lives and which key it reads.
import {
  OPENROUTER_DECISION_MODELS,
  type OpenRouterDecisionModels,
} from "./openrouter-decision-models.ts";

export interface SystemOneProvider {
  readonly keyEnv: string;
  readonly baseURL?: string;
  /** The key is never sent unless it matches; `message` is the thrown error, never the key. */
  readonly keyShape?: { readonly pattern: RegExp; readonly message: string };
  accepts(modelID: string): boolean;
  acceptsResponse(modelID: string, returned: string): boolean;
  /** Thrown by the invoker before any request. */
  incompatibleReason?(modelID: string): string | undefined;
  /** A non-blocking config warning. */
  configWarning?(modelID: string): string | undefined;
}

const JEV_MODEL = /^jev(?:-|$)/;
const COMMANDCODE_JEV = "typesafe/jev";
const LIQUID_DECISION_MODELS: ReadonlySet<string> = new Set(["d1", "d1-ultra"]);

export const BASETEN_DECISION_MODELS: ReadonlySet<string> = new Set([
  "decision-models/baseten-elephant-9b-latest",
  "decision-models/baseten-mammoth-27b-latest",
]);

const isJev = (modelID: string): boolean => JEV_MODEL.test(modelID);
const returnsJev = (_modelID: string, returned: string): boolean =>
  isJev(returned);
const sameModel = (modelID: string, returned: string): boolean =>
  returned === modelID;

// New Jev and d1 releases count before the weekly list picks them up. A `~`
// goes only with a `-latest` alias, the only form acceptsResponse can answer.
const OPENROUTER_FAMILIES: readonly RegExp[] = [
  /^(?:typesafe\/jev-\d[a-z0-9.-]*(?<!-latest)|~typesafe\/jev-latest)$/,
  /^(?:liquid\/d1(?:[-.][a-z0-9.-]*)?(?<!-latest)|~liquid\/d1(?:[-.][a-z0-9.-]*)?-latest)$/,
];
const OPENROUTER_ROUTING_SUFFIX = /:[a-z0-9-]+$/;
const OPENROUTER_ALIAS = /^~(.+)-latest$/;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OPENROUTER_MODELS: OpenRouterDecisionModels["models"] =
  OPENROUTER_DECISION_MODELS.models;
const OPENROUTER_INCOMPATIBLE: Readonly<Record<string, string>> =
  OPENROUTER_DECISION_MODELS.incompatible;

// The exact id first, so an id listed with its own tag keeps its entry.
const withoutRoutingSuffix = (modelID: string): readonly string[] => {
  const stripped = modelID.replace(OPENROUTER_ROUTING_SUFFIX, "");
  return stripped === modelID ? [modelID] : [modelID, stripped];
};

const openRouterIncompatibleReason = (modelID: string): string | undefined => {
  for (const id of withoutRoutingSuffix(modelID))
    if (Object.hasOwn(OPENROUTER_INCOMPATIBLE, id))
      return OPENROUTER_INCOMPATIBLE[id];
  return;
};

const openRouterConfigWarning = (modelID: string): string | undefined => {
  const reason = openRouterIncompatibleReason(modelID);
  if (reason !== undefined)
    return `openrouter/${modelID} is known to reject the reviewer's request (${reason}); every review will fail`;
  const listed = withoutRoutingSuffix(modelID).find((id) =>
    Object.hasOwn(OPENROUTER_MODELS, id),
  );
  if (listed !== undefined && OPENROUTER_MODELS[listed]?.benchmarked === true)
    return;
  return `openrouter/${modelID} has not been benchmarked as a reviewer; see REVIEWER-MODELS.md`;
};

const openRouterAccepts = (modelID: string): boolean =>
  openRouterIncompatibleReason(modelID) !== undefined ||
  withoutRoutingSuffix(modelID).some(
    (id) =>
      Object.hasOwn(OPENROUTER_DECISION_MODELS.models, id) ||
      OPENROUTER_FAMILIES.some((family) => family.test(id)),
  );

// OpenRouter answers with the dated canonical slug, and an alias with the
// slug of whichever release it points at.
const openRouterAcceptsResponse = (
  modelID: string,
  returned: string,
): boolean => {
  const base = modelID.replace(OPENROUTER_ROUTING_SUFFIX, "");
  const alias = OPENROUTER_ALIAS.exec(base)?.[1];
  if (alias !== undefined)
    return new RegExp(`^${escapeRegExp(alias)}(?:$|[-.])`).test(returned);
  return (
    returned === base ||
    new RegExp(`^${escapeRegExp(base)}-\\d{8}$`).test(returned)
  );
};

export const SYSTEM_ONE_PROVIDERS: Readonly<Record<string, SystemOneProvider>> =
  {
    opencode: {
      keyEnv: "OPENCODE_API_KEY",
      baseURL: "https://opencode.ai/zen",
      accepts: isJev,
      acceptsResponse: returnsJev,
    },
    "typesafe-ai": {
      keyEnv: "TYPESAFE_API_KEY",
      accepts: isJev,
      acceptsResponse: returnsJev,
    },
    commandcode: {
      keyEnv: "CMD_API_KEY",
      baseURL: "https://api.commandcode.ai/provider",
      accepts: (modelID: string): boolean => modelID === COMMANDCODE_JEV,
      acceptsResponse: (_modelID: string, returned: string): boolean =>
        returned === COMMANDCODE_JEV,
    },
    "liquid-ai": {
      keyEnv: "LIQUID_API_KEY",
      baseURL: "https://api.liquid.ai/decisions",
      keyShape: {
        pattern: /^liquid_[A-Za-z0-9]{32,}$/,
        message:
          'LIQUID_API_KEY is not a Liquid AI key (expected the "liquid_" prefix)',
      },
      accepts: (modelID: string): boolean =>
        LIQUID_DECISION_MODELS.has(modelID),
      acceptsResponse: sameModel,
    },
    baseten: {
      keyEnv: "BASETEN_API_KEY",
      baseURL: "https://inference.baseten.co",
      accepts: (modelID: string): boolean =>
        BASETEN_DECISION_MODELS.has(modelID),
      acceptsResponse: sameModel,
    },
    openrouter: {
      keyEnv: "OPENROUTER_API_KEY",
      baseURL: "https://openrouter.ai/api",
      keyShape: {
        pattern: /^sk-or-v1-[0-9a-f]{64}$/,
        message:
          'OPENROUTER_API_KEY is not an OpenRouter key (expected the "sk-or-v1-" prefix)',
      },
      accepts: openRouterAccepts,
      acceptsResponse: openRouterAcceptsResponse,
      incompatibleReason: openRouterIncompatibleReason,
      configWarning: openRouterConfigWarning,
    },
  };
