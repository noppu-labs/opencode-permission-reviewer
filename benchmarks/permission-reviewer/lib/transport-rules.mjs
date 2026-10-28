import { assert } from "./util.mjs";

export const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function systemOneRules(model, url) {
  assert(url.protocol === "https:", "System One endpoint must use HTTPS.");
  assert(
    /^jev(?:-|$)/.test(model.model) || model.model === "typesafe/jev",
    "System One transport requires a Jev model ID.",
  );
  assert(
    model.format === "system_one",
    "System One transport requires system_one format.",
  );
  assert(
    model.apiKeyEnv !== undefined,
    "System One transport requires apiKeyEnv.",
  );
  assert(
    model.parameters === undefined,
    "System One transport does not accept parameters.",
  );
  assert(
    model.variant === undefined,
    "System One models do not accept reasoning variants.",
  );
  assert(
    model.hostPasswordEnv === undefined,
    "System One transport has no host password.",
  );
}
function openCodeRules(model, url) {
  assert(
    url.protocol === "http:" &&
      LOOPBACK.includes(url.hostname) &&
      url.pathname === "/",
    "OpenCode host must be a loopback HTTP server root.",
  );
  assert(
    /^[a-z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(model.model),
    "OpenCode model must use provider/model.",
  );
  assert(
    typeof model.variant === "string" && model.variant.length > 0,
    "OpenCode variant is required.",
  );
  assert(
    (model.format ?? "text") !== "tool",
    "OpenCode V1 transport does not support the tool profile.",
  );
  assert(
    model.apiKeyEnv === undefined && model.parameters === undefined,
    "OpenCode transport uses the host's credentials and variants, not direct API parameters.",
  );
  assert(
    typeof model.hostPasswordEnv === "string" &&
      ENV_NAME.test(model.hostPasswordEnv),
    "OpenCode transport requires a hostPasswordEnv environment variable for local server authentication.",
  );
}
function commandCodeRules(model) {
  assert(
    model.endpoint === undefined,
    "Command Code CLI transport has no endpoint.",
  );
  assert(
    model.apiKeyEnv === undefined,
    "Command Code CLI uses its own authenticated session.",
  );
  assert(
    model.hostPasswordEnv === undefined,
    "Command Code CLI has no host password.",
  );
  assert(
    model.parameters === undefined,
    "Command Code CLI does not accept API parameters.",
  );
  assert(
    model.format === "text",
    "Command Code CLI supports only the text profile.",
  );
  assert(
    typeof model.variant === "string" &&
      ["low", "high", "max"].includes(model.variant),
    "Command Code CLI requires a supported effort variant.",
  );
  assert(
    typeof model.commandCodeBinEnv === "string" &&
      ENV_NAME.test(model.commandCodeBinEnv),
    "Command Code CLI requires a binary-path environment variable.",
  );
}
function chatRules(model) {
  assert(
    model.hostPasswordEnv === undefined,
    "hostPasswordEnv is only for OpenCode transport.",
  );
}
const RULES = new Map([
  ["chat-completions", chatRules],
  ["opencode-v1", openCodeRules],
  ["command-code-cli", commandCodeRules],
  ["system-one", systemOneRules],
]);
export const TRANSPORTS = [...RULES.keys()];

export function checkTransport(transport, model, url) {
  RULES.get(transport)(model, url);
}
