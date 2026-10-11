import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requestCommandCodeCli } from "../lib/command-code-cli.mjs";
import { exists } from "../lib/util.mjs";
import { fakeCommandCode } from "./command-code-fixture.mjs";
import { inSequence, withEnv } from "./run-fixtures.mjs";

const model = {
  id: "cli",
  model: "provider/synthetic",
  transport: "command-code-cli",
  commandCodeBinEnv: "PRB_TEST_CC_BIN",
  variant: "low",
  format: "text",
};
const prepared = { system: "POLICY", user: "EVIDENCE" };
const FAILURE_KEYS = ["ok", "status", "error", "rawText", "latencyMs", "halt"];

/** Run one request against the stand-in CLI in `mode`. */
async function request(mode, options = {}) {
  const cli = await fakeCommandCode();
  try {
    return await withEnv(
      {
        PRB_TEST_CC_BIN: cli.binary,
        PRB_TEST_CC_MODE: mode,
        COMMAND_CODE_API_KEY: "synthetic-cc-key",
        CMD_API_KEY: "synthetic-cmd-key",
      },
      () => requestCommandCodeCli(model, prepared, options),
    );
  } finally {
    await cli.remove();
  }
}
const failed = (result) => {
  assert.deepEqual(Object.keys(result), FAILURE_KEYS);
  assert.deepEqual(
    [result.ok, result.status, result.rawText, result.halt],
    [false, null, "", true],
  );
  return result.error;
};

test("the CLI gets the folded query, fixed flags, no API keys and a private working directory", async () => {
  const result = await request("echo", { retryNote: "NOTE" });
  const seen = JSON.parse(result.extracted.text);
  assert.equal(
    seen.query,
    "<reviewer_system>\nPOLICY\n</reviewer_system>\n\n<permission_request>\nEVIDENCE\n\nNOTE\n</permission_request>",
  );
  assert.deepEqual(seen.args, [
    "--no-auto-update",
    "--no-session",
    "--no-skills",
    "--skip-onboarding",
    "--trust",
    "--permission-mode",
    "dont-ask",
    "--max-turns",
    "1",
    "--model",
    "provider/synthetic",
    "--effort",
    "low",
    "--output-format",
    "json",
    "-p",
  ]);
  assert.equal(seen.noColor, "1");
  assert.deepEqual(seen.keys, [null, null]);
  assert(
    seen.cwd.startsWith(join(realpathSync(tmpdir()), "prb-command-code-")),
  );
  assert.equal(await exists(seen.cwd), false);
  assert.deepEqual(Object.keys(result), [
    "ok",
    "status",
    "raw",
    "rawText",
    "extracted",
    "latencyMs",
    "returnedModel",
    "usage",
  ]);
  const raw = {
    host: "command-code-cli",
    model: "provider/synthetic",
    variant: "low",
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 },
    finalText: result.extracted.text,
  };
  assert.deepEqual(
    { ...result, latencyMs: 0 },
    {
      ok: true,
      status: 200,
      raw,
      rawText: JSON.stringify(raw),
      extracted: { text: result.extracted.text },
      latencyMs: 0,
      returnedModel: "provider/synthetic",
      usage: { prompt_tokens: 10, completion_tokens: 5, cache_read_tokens: 2 },
    },
  );
});

test("an empty or non-text answer is a protocol error and missing usage stays null", async () => {
  const empty = await request("empty");
  assert.deepEqual(empty.extracted, {
    text: "",
    protocolError: "No final text.",
  });
  const number = await request("number");
  assert.deepEqual(number.extracted, {
    text: "",
    protocolError: "No final text.",
  });
  assert.equal(number.raw.finalText, 5);
  const bare = await request("no-usage");
  assert.equal(bare.usage, null);
  assert.equal(bare.raw.usage, null);
  const partial = await request("partial-usage");
  assert.deepEqual(partial.usage, {
    prompt_tokens: null,
    completion_tokens: null,
    cache_read_tokens: null,
  });
});

const refusals = [
  ["exit3", "Command Code exited with code 3."],
  ["other-model", "Command Code returned a different model."],
  ["tool", "Command Code attempted a tool action."],
  ["incomplete", "Command Code did not return one completed answer."],
  ["max-turns", "Command Code did not return one completed answer."],
  ["flood", "Command Code emitted excessive output."],
];

test("every unusable CLI outcome becomes a halting failure with its exact reason", async () =>
  inSequence(refusals, async ([mode, error]) => {
    assert.equal(failed(await request(mode)), error, mode);
  }));

test("the timeout terminates the CLI, escalating to SIGKILL when SIGTERM is ignored", async () => {
  assert.equal(
    failed(await request("hang", { timeoutMs: 100 })),
    "Command Code request timed out.",
  );
  const started = performance.now();
  assert.equal(
    failed(await request("ignore-term", { timeoutMs: 1000 })),
    "Command Code request timed out.",
  );
  assert(performance.now() - started >= 4000);
});

test("an abort before or during the request is an interruption", async () => {
  const before = new AbortController();
  before.abort();
  assert.equal(
    failed(await request("echo", { signal: before.signal })),
    "Benchmark request was interrupted",
  );
  const during = new AbortController();
  setTimeout(() => during.abort(), 100);
  assert.equal(
    failed(await request("hang", { signal: during.signal })),
    "Command Code request was interrupted.",
  );
});

test("a missing binary variable throws and an unspawnable binary halts", async () => {
  await assert.rejects(
    requestCommandCodeCli(
      { ...model, commandCodeBinEnv: "PRB_TEST_CC_UNSET" },
      prepared,
    ),
    {
      message:
        "Missing Command Code binary environment variable PRB_TEST_CC_UNSET",
    },
  );
  const missing = await withEnv(
    { PRB_TEST_CC_BIN: "/nonexistent/commandcode" },
    () => requestCommandCodeCli(model, prepared),
  );
  assert.equal(failed(missing), "spawn /nonexistent/commandcode ENOENT");
});
