import assert from "node:assert/strict";
import test from "node:test";
import { validateModel } from "../lib/model-validation.mjs";

const chat = {
  id: "chat",
  model: "provider-model",
  endpoint: "https://provider.invalid/v1/chat/completions",
};
const granite = {
  id: "granite",
  model: "granite-4.2-8b",
  endpoint: "http://127.0.0.1:7860/v1/chat/completions",
  graniteThinkingMode: "off",
};
const systemOne = {
  id: "jev",
  model: "jev-1",
  endpoint: "https://system-one.invalid/zen",
  apiKeyEnv: "PRB_KEY",
  transport: "system-one",
  format: "system_one",
};
const opencode = {
  id: "host",
  model: "openai/model",
  endpoint: "http://localhost:4096/",
  transport: "opencode-v1",
  variant: "low",
  hostPasswordEnv: "PRB_PASSWORD",
};
const cli = {
  id: "cli",
  model: "provider/model",
  transport: "command-code-cli",
  commandCodeBinEnv: "PRB_BIN",
  variant: "max",
  format: "text",
};

const rejected = [
  [null, "Model id must be a safe unique label."],
  [{ ...chat, id: "bad id" }, "Model id must be a safe unique label."],
  [{ ...chat, model: "" }, "chat: model identifier missing"],
  [{ ...chat, transport: "grpc" }, "chat: unsupported transport"],
  [{ ...chat, endpoint: undefined }, "chat: endpoint missing"],
  [
    { ...chat, endpoint: "https://u:p@provider.invalid/" },
    "Do not put credentials, query strings or fragments in endpoint URLs.",
  ],
  [
    { ...chat, endpoint: "https://provider.invalid/#x" },
    "Do not put credentials, query strings or fragments in endpoint URLs.",
  ],
  [
    { ...chat, endpoint: "ftp://provider.invalid/" },
    "Use HTTPS, except for loopback local servers.",
  ],
  [
    { ...chat, endpoint: "http://[::2]/" },
    "Use HTTPS, except for loopback local servers.",
  ],
  [
    { ...chat, format: "xml" },
    "chat: format must be text, json_schema, tool or system_one",
  ],
  [
    { ...granite, graniteThinkingMode: "high" },
    "granite: graniteThinkingMode must be off, low or full",
  ],
  [
    { ...granite, endpoint: "https://provider.invalid/" },
    "granite: graniteThinkingMode requires the local Granite 4.2 8B text profile",
  ],
  [
    { ...cli, graniteThinkingMode: "off" },
    "cli: graniteThinkingMode requires the local Granite 4.2 8B text profile",
  ],
  [
    { ...systemOne, endpoint: "http://localhost/zen" },
    "System One endpoint must use HTTPS.",
  ],
  [
    { ...systemOne, model: "typesafe/other" },
    "System One transport requires a Jev model ID.",
  ],
  [
    { ...systemOne, format: undefined },
    "System One transport requires system_one format.",
  ],
  [
    { ...systemOne, apiKeyEnv: undefined },
    "System One transport requires apiKeyEnv.",
  ],
  [
    { ...systemOne, parameters: {} },
    "System One transport does not accept parameters.",
  ],
  [
    { ...systemOne, variant: "low" },
    "System One models do not accept reasoning variants.",
  ],
  [
    { ...systemOne, hostPasswordEnv: "PRB_PASSWORD" },
    "System One transport has no host password.",
  ],
  [
    { ...opencode, endpoint: "http://localhost:4096/v1" },
    "OpenCode host must be a loopback HTTP server root.",
  ],
  [
    { ...opencode, endpoint: "https://localhost:4096/" },
    "OpenCode host must be a loopback HTTP server root.",
  ],
  [{ ...opencode, model: "model" }, "OpenCode model must use provider/model."],
  [{ ...opencode, variant: "" }, "OpenCode variant is required."],
  [
    { ...opencode, format: "tool" },
    "OpenCode V1 transport does not support the tool profile.",
  ],
  [
    { ...opencode, parameters: {} },
    "OpenCode transport uses the host's credentials and variants, not direct API parameters.",
  ],
  [
    { ...opencode, hostPasswordEnv: "1X" },
    "OpenCode transport requires a hostPasswordEnv environment variable for local server authentication.",
  ],
  [
    { ...cli, endpoint: "https://provider.invalid/" },
    "Command Code CLI transport has no endpoint.",
  ],
  [
    { ...cli, apiKeyEnv: "PRB_KEY" },
    "Command Code CLI uses its own authenticated session.",
  ],
  [
    { ...cli, hostPasswordEnv: "PRB_PASSWORD" },
    "Command Code CLI has no host password.",
  ],
  [
    { ...cli, parameters: {} },
    "Command Code CLI does not accept API parameters.",
  ],
  [
    { ...cli, format: undefined },
    "Command Code CLI supports only the text profile.",
  ],
  [
    { ...cli, variant: "medium" },
    "Command Code CLI requires a supported effort variant.",
  ],
  [
    { ...cli, commandCodeBinEnv: "bin path" },
    "Command Code CLI requires a binary-path environment variable.",
  ],
  [
    { ...chat, hostPasswordEnv: "PRB_PASSWORD" },
    "hostPasswordEnv is only for OpenCode transport.",
  ],
  [
    { ...chat, apiKeyEnv: "not a name" },
    "apiKeyEnv must name an environment variable, not contain a key.",
  ],
  [
    { ...chat, parameters: { temperature: 0, tool_choice: "none" } },
    "Reserved provider parameter: tool_choice",
  ],
  [
    { ...chat, extra: true },
    "Unknown model configuration key extra. Use parameters for provider options; secrets only via apiKeyEnv.",
  ],
  [
    { ...chat, pricesPerMillion: { input: 1, output: -1 } },
    "Prices must be nonnegative numbers.",
  ],
  [
    { ...chat, pricesPerMillion: { input: "1" } },
    "Prices must be nonnegative numbers.",
  ],
];

test("model validation rejects each invalid profile with its exact message, in check order", () =>
  rejected.forEach(([model, message]) => {
    assert.throws(() => validateModel(model), { message }, message);
  }));

test("an unparsable endpoint is the runtime's URL error", () => {
  assert.throws(() => validateModel({ ...chat, endpoint: "not a url" }), {
    code: "ERR_INVALID_URL",
  });
});

test("model validation fills the default transport and format after the given keys", () => {
  assert.deepEqual(Object.entries(validateModel(chat)), [
    ...Object.entries(chat),
    ["transport", "chat-completions"],
    ["format", "text"],
  ]);
  assert.deepEqual(Object.keys(validateModel({ ...cli, notes: "n" })), [
    ...Object.keys(cli),
    "notes",
  ]);
  for (const model of [
    granite,
    { ...granite, graniteThinkingMode: "low" },
    systemOne,
    opencode,
    cli,
  ])
    assert.equal(validateModel(model).id, model.id);
  assert.equal(
    validateModel({ ...opencode, endpoint: "http://[::1]:4096/" }).id,
    "host",
  );
  assert.equal(
    validateModel({ ...chat, pricesPerMillion: { input: 0, output: 2 } }).id,
    "chat",
  );
});
