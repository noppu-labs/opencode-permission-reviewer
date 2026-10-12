import {
  checkTransport,
  ENV_NAME,
  LOOPBACK,
  TRANSPORTS,
} from "./transport-rules.mjs";
import { assert } from "./util.mjs";

const RESERVED = new Set([
  "model",
  "messages",
  "stream",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
  "n",
  "api_key",
  "authorization",
]);
const FORMATS = new Set(["text", "json_schema", "tool", "system_one"]);
const ALLOWED = new Set([
  "id",
  "model",
  "endpoint",
  "apiKeyEnv",
  "format",
  "graniteThinkingMode",
  "parameters",
  "variant",
  "pricesPerMillion",
  "notes",
  "transport",
  "hostPasswordEnv",
  "commandCodeBinEnv",
]);

function endpointURL(model, transport) {
  if (transport === "command-code-cli") return null;
  assert(typeof model.endpoint === "string", `${model.id}: endpoint missing`);
  const url = new URL(model.endpoint);
  assert(
    !url.username && !url.password && !url.search && !url.hash,
    "Do not put credentials, query strings or fragments in endpoint URLs.",
  );
  assert(
    url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK.includes(url.hostname)),
    "Use HTTPS, except for loopback local servers.",
  );
  return url;
}
function checkGranite(model, transport, url) {
  assert(
    ["off", "low", "full"].includes(model.graniteThinkingMode),
    `${model.id}: graniteThinkingMode must be off, low or full`,
  );
  assert(
    transport === "chat-completions" &&
      model.model === "granite-4.2-8b" &&
      (model.format ?? "text") === "text" &&
      url.protocol === "http:" &&
      LOOPBACK.includes(url.hostname),
    `${model.id}: graniteThinkingMode requires the local Granite 4.2 8B text profile`,
  );
}
function checkKeys(model) {
  if (model.apiKeyEnv !== undefined)
    assert(
      typeof model.apiKeyEnv === "string" && ENV_NAME.test(model.apiKeyEnv),
      "apiKeyEnv must name an environment variable, not contain a key.",
    );
  for (const k of Object.keys(model.parameters ?? {}))
    assert(!RESERVED.has(k), `Reserved provider parameter: ${k}`);
  for (const k of Object.keys(model))
    assert(
      ALLOWED.has(k),
      `Unknown model configuration key ${k}. Use parameters for provider options; secrets only via apiKeyEnv.`,
    );
  if (model.pricesPerMillion)
    for (const v of Object.values(model.pricesPerMillion))
      assert(
        Number.isFinite(v) && v >= 0,
        "Prices must be nonnegative numbers.",
      );
}
export function validateModel(model) {
  assert(
    model && typeof model.id === "string" && /^[a-zA-Z0-9_.-]+$/.test(model.id),
    "Model id must be a safe unique label.",
  );
  assert(
    typeof model.model === "string" && model.model.length > 0,
    `${model.id}: model identifier missing`,
  );
  const transport = model.transport ?? "chat-completions";
  assert(TRANSPORTS.includes(transport), `${model.id}: unsupported transport`);
  const url = endpointURL(model, transport);
  assert(
    FORMATS.has(model.format ?? "text"),
    `${model.id}: format must be text, json_schema, tool or system_one`,
  );
  if (model.graniteThinkingMode !== undefined)
    checkGranite(model, transport, url);
  checkTransport(transport, model, url);
  checkKeys(model);
  return { ...model, transport, format: model.format ?? "text" };
}
