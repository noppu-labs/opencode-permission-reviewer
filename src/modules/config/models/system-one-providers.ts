// The providers that serve System One decision models: which model IDs each
// accepts, where its endpoint lives and which key it reads.
import { OPENROUTER_DECISION_MODELS } from "./openrouter-decision-models.ts";

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

// New Jev and d1 releases count before the weekly list picks them up.
const OPENROUTER_FAMILIES: readonly RegExp[] = [
  /^~?typesafe\/jev-(?:\d|latest)/,
  /^~?liquid\/d1(?:$|[-.:])/,
];
const OPENROUTER_ROUTING_SUFFIX = /:[a-z0-9-]+$/;
const OPENROUTER_ALIAS = /^~(.+)-latest$/;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const OPENROUTER_INCOMPATIBLE: Readonly<Record<string, string>> =
  OPENROUTER_DECISION_MODELS.incompatible;

const openRouterIncompatibleReason = (modelID: string): string | undefined =>
  Object.hasOwn(OPENROUTER_INCOMPATIBLE, modelID)
    ? OPENROUTER_INCOMPATIBLE[modelID]
    : undefined;

const openRouterAccepts = (modelID: string): boolean =>
  Object.hasOwn(OPENROUTER_DECISION_MODELS.models, modelID) ||
  openRouterIncompatibleReason(modelID) !== undefined ||
  OPENROUTER_FAMILIES.some((family) => family.test(modelID));

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
    },
  };
