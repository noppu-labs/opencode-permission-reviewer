import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runBenchmark } from "../lib/run.mjs";
import { readJSON } from "../lib/util.mjs";
import { fakeAdapter, model } from "./helpers.mjs";
import {
  failure,
  inSequence,
  inTemp,
  rowsOf,
  runInput,
  scripted,
  withEnv,
} from "./run-fixtures.mjs";

const env = {
  PRB_RUN_KEY: "synthetic-key",
  PRB_RUN_PASSWORD: "synthetic-password",
  PRB_RUN_BIN: "/nonexistent/prb-command-code",
};
const hosts = {
  chat: model,
  opencode: {
    id: "host",
    model: "openai/synthetic",
    endpoint: "http://127.0.0.1:1/",
    transport: "opencode-v1",
    variant: "low",
    format: "text",
    hostPasswordEnv: "PRB_RUN_PASSWORD",
  },
  systemOne: {
    id: "jev",
    model: "jev-1",
    endpoint: "https://127.0.0.1:1/zen",
    apiKeyEnv: "PRB_RUN_KEY",
    transport: "system-one",
    format: "system_one",
  },
  commandCode: {
    id: "cli",
    model: "provider/synthetic",
    transport: "command-code-cli",
    commandCodeBinEnv: "PRB_RUN_BIN",
    variant: "high",
    format: "text",
  },
};
const keyed = { ...model, id: "keyed", apiKeyEnv: "PRB_RUN_MISSING_KEY" };
const guards = [
  [{ track: "x" }, [model], "track must be reviewer or system"],
  [{ repeats: 0 }, [], "repeats"],
  [{ concurrency: 0 }, [model], "concurrency"],
  [{ minRequestDelayMs: -1 }, [model], "minRequestDelayMs"],
  [
    { minRequestDelayMs: 5, maxRequestDelayMs: 4 },
    [model],
    "maxRequestDelayMs",
  ],
  [{ maxRequestDelayMs: 60001 }, [model], "maxRequestDelayMs"],
  [
    { maxRequestDelayMs: 1, concurrency: 2 },
    [model],
    "A request delay requires --concurrency 1.",
  ],
  [{}, [{ ...model, id: "bad id" }], "Model id must be a safe unique label."],
  [{}, [model, model], "Duplicate model id."],
  [{}, [], "No models configured."],
  [
    { concurrency: 4 },
    [hosts.opencode],
    "OpenCode subscription runs permit at most three workers.",
  ],
  [
    { concurrency: 3 },
    [hosts.commandCode],
    "Command Code subscription runs permit at most two workers.",
  ],
  [
    { formatRetries: 1 },
    [hosts.systemOne],
    "System One runs require zero format retries and at most two workers.",
  ],
  [
    {},
    [{ ...hosts.opencode, hostPasswordEnv: "PRB_RUN_MISSING_PASSWORD" }, keyed],
    "Missing credential environment variable PRB_RUN_MISSING_KEY",
  ],
  [
    {},
    [{ ...hosts.opencode, hostPasswordEnv: "PRB_RUN_MISSING_PASSWORD" }],
    "Missing host password environment variable PRB_RUN_MISSING_PASSWORD",
  ],
  [
    {},
    [{ ...hosts.commandCode, commandCodeBinEnv: "PRB_RUN_MISSING_BIN" }],
    "Missing Command Code binary environment variable PRB_RUN_MISSING_BIN",
  ],
];

test("run options and model guards keep their order and exact messages", async () =>
  withEnv(env, async () => {
    await inSequence(guards, ([options, models, message]) =>
      inTemp(async (dir) => {
        await assert.rejects(
          runBenchmark({
            ...runInput(dir, options, 1),
            models,
            completion: scripted(failure(400)),
          }),
          { message },
        );
      }),
    );
  }));

const protocols = {
  chat: "direct-chat-completions + actual plugin evidence/prompt/parser/core replay; NOT native OpenCode host E2E",
  opencode:
    "OpenCode V1 session transport + actual plugin evidence/prompt/parser/core replay; NOT permission lifecycle E2E",
  systemOne:
    "System One typed-decision transport + actual plugin evidence/reconciliation/core replay; PRIVATE EVALUATION",
  commandCode:
    "Command Code CLI headless transport with role-folded user prompt + actual plugin evidence/parser/core replay; NOT controlled with OpenCode V1 or permission lifecycle E2E",
};
const modes = {
  chat: "live-provider-core-replay",
  opencode: "opencode-v1-session-core-replay",
  systemOne: "system-one-core-replay",
  commandCode: "live-provider-core-replay",
};

const mixes = [
  [["chat"], "chat"],
  [["opencode"], "opencode"],
  [["systemOne"], "systemOne"],
  [["commandCode"], "commandCode"],
  [["chat", "opencode"], "opencode"],
  [["opencode", "systemOne"], "systemOne"],
  [["systemOne", "commandCode"], "commandCode"],
];

test("the manifest protocol and row run mode follow the configured transports", async () =>
  withEnv(env, async () => {
    await inSequence(mixes, ([names, protocol]) =>
      inTemp(async (dir) => {
        await runBenchmark({
          ...runInput(dir, { storePrompts: false }, 1),
          models: names.map((n) => hosts[n]),
          completion: scripted(failure(400)),
        });
        assert.equal(
          (await readJSON(join(dir, "run.json"))).protocol,
          protocols[protocol],
        );
        const byModel = Object.fromEntries(
          (await rowsOf(dir)).map((r) => [r.modelId, r.runMode]),
        );
        assert.deepEqual(
          byModel,
          Object.fromEntries(names.map((n) => [hosts[n].id, modes[n]])),
        );
      }),
    );
  }));

test("without a completion override each transport reaches its own client", async (t) =>
  withEnv(env, async () => {
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      urls.push(String(url));
      return new Response("{}", { status: 503 });
    });
    const errors = {};
    await inSequence(Object.keys(hosts), (name) =>
      inTemp(async (dir) => {
        await runBenchmark({
          ...runInput(dir, { storePrompts: false }, 1),
          models: [hosts[name]],
          adapter: {
            ...fakeAdapter,
            prepare: async (input) => ({
              ...(await fakeAdapter.prepare(input)),
              systemOne: { state: {}, questions: {} },
            }),
          },
        });
        errors[name] = (await rowsOf(dir))[0].attempts[0].error;
      }),
    );
    assert.equal(urls[0], model.endpoint);
    assert.match(urls[1], /^http:\/\/127\.0\.0\.1:1\/session\?directory=/);
    assert.equal(errors.chat, "HTTP 503");
    assert.equal(
      errors.opencode,
      "OpenCode instance cleanup failed after 3 attempts: OpenCode HTTP 503",
    );
    // The System One client rejects the empty question set before any request.
    assert.equal(errors.systemOne, "At least one question is required.");
    assert.match(errors.commandCode, /ENOENT/);
  }));
