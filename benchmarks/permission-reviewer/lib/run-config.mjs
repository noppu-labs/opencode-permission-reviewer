import { requestCommandCodeCli } from "./command-code-cli.mjs";
import { validateModel } from "./model-validation.mjs";
import { requestOpenCodeV1 } from "./opencode-v1.mjs";
import { requestCompletion } from "./providers.mjs";
import { requestSystemOne } from "./system-one.mjs";
import { assert } from "./util.mjs";

const DEFAULTS = {
  repeats: 1,
  concurrency: 2,
  seed: 17,
  track: "reviewer",
  timeoutMs: 120000,
  maxCalls: 1200,
  minRequestDelayMs: 0,
  maxRequestDelayMs: 0,
  httpRetries: 1,
  formatRetries: 1,
  bootstrap: 500,
  storePrompts: true,
  resume: false,
};
// Worker caps per subscription transport, checked in this order.
const WORKER_CAPS = [
  [
    "opencode-v1",
    (cfg) => cfg.concurrency <= 3,
    "OpenCode subscription runs permit at most three workers.",
  ],
  [
    "command-code-cli",
    (cfg) => cfg.concurrency <= 2,
    "Command Code subscription runs permit at most two workers.",
  ],
  [
    "system-one",
    (cfg) => cfg.formatRetries === 0 && cfg.concurrency <= 2,
    "System One runs require zero format retries and at most two workers.",
  ],
];
// Every model's credential of one kind is checked before the next kind.
const REQUIRED_ENV = [
  ["apiKeyEnv", "Missing credential environment variable"],
  ["hostPasswordEnv", "Missing host password environment variable"],
  ["commandCodeBinEnv", "Missing Command Code binary environment variable"],
];

export function runConfig(options) {
  const cfg = { ...DEFAULTS, ...options };
  assert(
    ["reviewer", "system"].includes(cfg.track),
    "track must be reviewer or system",
  );
  assert(Number.isInteger(cfg.repeats) && cfg.repeats > 0, "repeats");
  assert(
    Number.isInteger(cfg.concurrency) && cfg.concurrency > 0,
    "concurrency",
  );
  assert(
    Number.isInteger(cfg.minRequestDelayMs) && cfg.minRequestDelayMs >= 0,
    "minRequestDelayMs",
  );
  assert(
    Number.isInteger(cfg.maxRequestDelayMs) &&
      cfg.maxRequestDelayMs >= cfg.minRequestDelayMs &&
      cfg.maxRequestDelayMs <= 60000,
    "maxRequestDelayMs",
  );
  if (cfg.maxRequestDelayMs > 0)
    assert(cfg.concurrency === 1, "A request delay requires --concurrency 1.");
  return cfg;
}

export function runModels(models, cfg) {
  const safeModels = models.map(validateModel);
  assert(
    new Set(safeModels.map((m) => m.id)).size === safeModels.length,
    "Duplicate model id.",
  );
  assert(safeModels.length > 0, "No models configured.");
  for (const [transport, permits, message] of WORKER_CAPS)
    if (safeModels.some((model) => model.transport === transport))
      assert(permits(cfg), message);
  for (const [field, message] of REQUIRED_ENV)
    for (const m of safeModels)
      if (m[field]) assert(process.env[m[field]], `${message} ${m[field]}`);
  return safeModels;
}

export function protocolFor(safeModels) {
  const uses = (transport) =>
    safeModels.some((model) => model.transport === transport);
  return uses("command-code-cli")
    ? "Command Code CLI headless transport with role-folded user prompt + actual plugin evidence/parser/core replay; NOT controlled with OpenCode V1 or permission lifecycle E2E"
    : uses("system-one")
      ? "System One typed-decision transport + actual plugin evidence/reconciliation/core replay; PRIVATE EVALUATION"
      : uses("opencode-v1")
        ? "OpenCode V1 session transport + actual plugin evidence/prompt/parser/core replay; NOT permission lifecycle E2E"
        : "direct-chat-completions + actual plugin evidence/prompt/parser/core replay; NOT native OpenCode host E2E";
}
/** The default completion: each model's configured transport. */
export const transportCompletion = (model, prepared, request) =>
  model.transport === "opencode-v1"
    ? requestOpenCodeV1(model, prepared, request)
    : model.transport === "command-code-cli"
      ? requestCommandCodeCli(model, prepared, request)
      : model.transport === "system-one"
        ? requestSystemOne(model, prepared, request)
        : requestCompletion(model, prepared, request);
